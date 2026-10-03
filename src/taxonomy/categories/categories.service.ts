import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types, UpdateQuery } from 'mongoose';
import type { AuthUser } from '../../auth/auth.types';
import { Paginated, toPage } from '../../common/types/paginated';
import { escapeRegex } from '../../common/utils/regex';
import { parseSort, resolveSlug, rethrowDuplicate } from '../taxonomy.utils';
import {
  CategoryCrumb,
  CategoryDetailView,
  CategoryListFilters,
  CategoryRecord,
  CategoryTreeNode,
  CategoryView,
} from './categories.types';
import { buildCategoryTree, CategoryTreeRecord } from './category-tree';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  ROOT_PARENT,
  UpdateCategoryDto,
} from './dto/categories.dto';
import { Category, MAX_CATEGORY_DEPTH } from './schemas/category.schema';

const CATEGORY_PROJECTION =
  'name slug description parent ancestors position createdAt updatedAt';
const TREE_PROJECTION = 'name slug description parent position';

// Hard cap on the public tree payload; a site with more categories than this
// needs paged navigation instead (GET /categories?parent=...).
export const MAX_TREE_SIZE = 1000;
// The tree is read on every page of the front-end but changes rarely. Writes
// on this instance invalidate it at once; other instances catch up within
// the TTL.
const TREE_CACHE_TTL_MS = 60_000;

const DUPLICATE_MESSAGES = {
  slug: 'A category with this slug already exists',
  name: 'A category with this name already exists at this level',
};

const DEPTH_MESSAGE = `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`;

// Filter values are typed by the DTO (ObjectId / null / escaped string), so
// no operator can be injected from user input.
export function buildCategoryListFilter(
  filters: CategoryListFilters,
): QueryFilter<Category> {
  const filter: QueryFilter<Category> = {};
  if (filters.parent !== undefined) filter.parent = filters.parent;
  if (filters.search) {
    filter.name = { $regex: `^${escapeRegex(filters.search)}`, $options: 'i' };
  }
  return filter;
}

export function parseParentFilter(
  parent: string | undefined,
): Types.ObjectId | null | undefined {
  if (parent === undefined) return undefined;
  return parent.toLowerCase() === ROOT_PARENT
    ? null
    : new Types.ObjectId(parent);
}

export function toCategoryView(c: CategoryRecord): CategoryView {
  return {
    id: c._id.toHexString(),
    name: c.name,
    slug: c.slug,
    description: c.description,
    parentId: c.parent ? c.parent.toHexString() : null,
    depth: c.ancestors.length + 1,
    position: c.position,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function sameId(a: Types.ObjectId | null, b: Types.ObjectId | null): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}

/**
 * Category CRUD. Reads are public; writes are admin-only (enforced by the
 * controller) and audited here. Invariants kept by this service:
 * - `ancestors` is always the path root -> parent (moves rebase the subtree);
 * - no cycles, at most MAX_CATEGORY_DEPTH levels;
 * - a category with subcategories can't be deleted.
 */
@Injectable()
export class CategoriesService {
  private readonly audit = new Logger('Audit');
  private readonly logger = new Logger(CategoriesService.name);
  private treeCache?: {
    expiresAt: number;
    value: Promise<CategoryTreeNode[]>;
  };

  constructor(
    @InjectModel(Category.name) private readonly model: Model<Category>,
  ) {}

  // ------------------------------------------------------------------ reads

  // One page + total count in parallel; lean + projection, no populate.
  async list(query: ListCategoriesQueryDto): Promise<Paginated<CategoryView>> {
    const { page, limit } = query;
    const filter = buildCategoryListFilter({
      search: query.search,
      parent: parseParentFilter(query.parent),
    });
    const hasFilter = Object.keys(filter).length > 0;
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(CATEGORY_PROJECTION)
        .sort(parseSort(query.sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CategoryRecord[]>()
        .exec(),
      hasFilter
        ? this.model.countDocuments(filter).exec()
        : this.model.estimatedDocumentCount().exec(),
    ]);
    return toPage(items.map(toCategoryView), total, page, limit);
  }

  // Whole tree from a single query, shared by concurrent callers.
  getTree(): Promise<CategoryTreeNode[]> {
    const now = Date.now();
    if (!this.treeCache || this.treeCache.expiresAt <= now) {
      const value = this.loadTree();
      this.treeCache = { expiresAt: now + TREE_CACHE_TTL_MS, value };
      // A failed read must not be served from the cache until it expires.
      value.catch(() => {
        if (this.treeCache?.value === value) this.treeCache = undefined;
      });
    }
    return this.treeCache.value;
  }

  async getById(id: Types.ObjectId): Promise<CategoryDetailView> {
    return this.toDetailView(await this.findOrThrow(id));
  }

  async getBySlug(slug: string): Promise<CategoryDetailView> {
    const category = await this.model
      .findOne({ slug })
      .select(CATEGORY_PROJECTION)
      .lean<CategoryRecord>()
      .exec();
    if (!category) throw new NotFoundException('Category not found');
    return this.toDetailView(category);
  }

  // Used by content modules: does a category with this id exist?
  async exists(id: Types.ObjectId): Promise<boolean> {
    return (await this.model.exists({ _id: id }).exec()) !== null;
  }

  /**
   * Ids of the category with this slug and of all its descendants (two
   * indexed reads), so content can be filtered by a whole subtree. Null when
   * the slug is unknown.
   */
  async findSubtreeIdsBySlug(slug: string): Promise<Types.ObjectId[] | null> {
    const root = await this.model
      .findOne({ slug })
      .select('_id')
      .lean<Pick<CategoryRecord, '_id'>>()
      .exec();
    if (!root) return null;
    const descendants = await this.model
      .find({ ancestors: root._id })
      .select('_id')
      .lean<Pick<CategoryRecord, '_id'>[]>()
      .exec();
    return [root._id, ...descendants.map((d) => d._id)];
  }

  // ----------------------------------------------------------------- writes

  async create(actor: AuthUser, dto: CreateCategoryDto): Promise<CategoryView> {
    const slug = resolveSlug(dto.slug, dto.name);
    let parent: Types.ObjectId | null = null;
    let ancestors: Types.ObjectId[] = [];
    if (dto.parentId !== undefined) {
      const parentRecord = await this.findParentOrThrow(
        new Types.ObjectId(dto.parentId),
      );
      parent = parentRecord._id;
      ancestors = [...parentRecord.ancestors, parentRecord._id];
      if (ancestors.length + 1 > MAX_CATEGORY_DEPTH) {
        throw new BadRequestException(DEPTH_MESSAGE);
      }
    }

    let created: CategoryRecord;
    try {
      // Explicit field mapping: the DTO is never spread into the document.
      const doc = await this.model.create({
        name: dto.name,
        slug,
        description: dto.description || undefined,
        parent,
        ancestors,
        position: dto.position ?? 0,
      });
      created = doc.toObject<CategoryRecord>();
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }

    this.invalidateTree();
    this.audit.log(
      `category.created actor=${actor.id} id=${created._id.toHexString()} slug=${created.slug}`,
    );
    return toCategoryView(created);
  }

  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    const current = await this.findOrThrow(id);

    const $set: Partial<
      Pick<
        Category,
        'name' | 'slug' | 'description' | 'position' | 'parent' | 'ancestors'
      >
    > = {};
    const $unset: { description?: 1 } = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      $set.name = dto.name;
    }
    if (dto.slug !== undefined && dto.slug !== current.slug) {
      $set.slug = dto.slug;
    }
    if (dto.description !== undefined) {
      if (dto.description === '') {
        if (current.description !== undefined) $unset.description = 1;
      } else if (dto.description !== current.description) {
        $set.description = dto.description;
      }
    }
    if (dto.position !== undefined && dto.position !== current.position) {
      $set.position = dto.position;
    }

    let moved = false;
    if (dto.parentId !== undefined) {
      const newParent =
        dto.parentId === null ? null : new Types.ObjectId(dto.parentId);
      if (!sameId(newParent, current.parent)) {
        $set.parent = newParent;
        $set.ancestors = await this.planMove(current, newParent);
        moved = true;
      }
    }

    const changed = [...Object.keys($set), ...Object.keys($unset)].filter(
      (k) => k !== 'ancestors',
    );
    if (changed.length === 0) {
      // Valid request that changes nothing: no write, no audit noise.
      return toCategoryView(current);
    }

    const update: UpdateQuery<Category> = {};
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    let updated: CategoryRecord | null;
    try {
      // Only applies if the category wasn't moved meanwhile, so the depth and
      // cycle checks above still hold.
      updated = await this.model
        .findOneAndUpdate(
          { _id: current._id, parent: current.parent },
          update,
          {
            returnDocument: 'after',
            runValidators: true,
          },
        )
        .select(CATEGORY_PROJECTION)
        .lean<CategoryRecord>()
        .exec();
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }
    if (!updated) {
      throw new ConflictException(
        'The category was moved or deleted concurrently, please retry',
      );
    }

    if (moved) {
      await this.rebaseDescendants(
        current._id,
        current.ancestors.length,
        updated.ancestors,
      );
    }

    this.invalidateTree();
    this.audit.log(
      `category.updated actor=${actor.id} id=${current._id.toHexString()} changes=${changed.join(',')}`,
    );
    return toCategoryView(updated);
  }

  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    if (await this.model.exists({ parent: id }).exec()) {
      throw new ConflictException(
        'This category has subcategories: move or delete them first',
      );
    }
    const deleted = await this.model
      .findOneAndDelete({ _id: id })
      .select('slug')
      .lean<Pick<CategoryRecord, '_id' | 'slug'>>()
      .exec();
    if (!deleted) throw new NotFoundException('Category not found');

    this.invalidateTree();
    this.audit.log(
      `category.deleted actor=${actor.id} id=${id.toHexString()} slug=${deleted.slug}`,
    );
  }

  // --------------------------------------------------------------- helpers

  private async loadTree(): Promise<CategoryTreeNode[]> {
    const records = await this.model
      .find()
      .select(TREE_PROJECTION)
      .sort({ position: 1, name: 1, _id: 1 })
      .limit(MAX_TREE_SIZE + 1)
      .lean<CategoryTreeRecord[]>()
      .exec();
    if (records.length > MAX_TREE_SIZE) {
      this.logger.warn(
        `Category tree truncated to ${MAX_TREE_SIZE} categories`,
      );
      records.length = MAX_TREE_SIZE;
    }
    return buildCategoryTree(records);
  }

  private invalidateTree(): void {
    this.treeCache = undefined;
  }

  private async findOrThrow(id: Types.ObjectId): Promise<CategoryRecord> {
    const category = await this.model
      .findById(id)
      .select(CATEGORY_PROJECTION)
      .lean<CategoryRecord>()
      .exec();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  // A parent referenced in a body is a validation error (400), not a 404 on
  // the route itself.
  private async findParentOrThrow(
    id: Types.ObjectId,
  ): Promise<Pick<CategoryRecord, '_id' | 'ancestors'>> {
    const parent = await this.model
      .findById(id)
      .select('ancestors')
      .lean<Pick<CategoryRecord, '_id' | 'ancestors'>>()
      .exec();
    if (!parent) throw new BadRequestException('Parent category not found');
    return parent;
  }

  // Breadcrumb from one $in query, ordered like `ancestors` (root first).
  private async toDetailView(c: CategoryRecord): Promise<CategoryDetailView> {
    let path: CategoryCrumb[] = [];
    if (c.ancestors.length > 0) {
      const crumbs = await this.model
        .find({ _id: { $in: c.ancestors } })
        .select('name slug')
        .lean<Pick<CategoryRecord, '_id' | 'name' | 'slug'>[]>()
        .exec();
      const byId = new Map(crumbs.map((a) => [a._id.toHexString(), a]));
      path = c.ancestors.flatMap((ancestorId) => {
        const a = byId.get(ancestorId.toHexString());
        return a
          ? [{ id: ancestorId.toHexString(), name: a.name, slug: a.slug }]
          : [];
      });
    }
    return { ...toCategoryView(c), path };
  }

  /**
   * Validates moving `category` under `newParent` and returns its new
   * ancestors. Rejects self-parenting, cycles (moving under one of its own
   * descendants) and moves that would push its deepest descendant past
   * MAX_CATEGORY_DEPTH.
   */
  private async planMove(
    category: CategoryRecord,
    newParent: Types.ObjectId | null,
  ): Promise<Types.ObjectId[]> {
    let ancestors: Types.ObjectId[] = [];
    if (newParent) {
      if (newParent.equals(category._id)) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      const parent = await this.findParentOrThrow(newParent);
      if (parent.ancestors.some((a) => a.equals(category._id))) {
        throw new BadRequestException(
          'A category cannot be moved under one of its own subcategories',
        );
      }
      ancestors = [...parent.ancestors, parent._id];
    }

    if (
      ancestors.length + (await this.subtreeHeight(category)) >
      MAX_CATEGORY_DEPTH
    ) {
      throw new BadRequestException(DEPTH_MESSAGE);
    }
    return ancestors;
  }

  // Number of levels in the subtree rooted at `category` (1 = no children).
  private async subtreeHeight(category: CategoryRecord): Promise<number> {
    const [deepest] = await this.model
      .aggregate<{ maxAncestors: number }>([
        { $match: { ancestors: category._id } },
        {
          $group: {
            _id: null,
            maxAncestors: { $max: { $size: '$ancestors' } },
          },
        },
      ])
      .exec();
    return deepest ? deepest.maxAncestors - category.ancestors.length + 1 : 1;
  }

  // Replaces the old path prefix of every descendant with the moved
  // category's new ancestors, in one server-side update.
  private async rebaseDescendants(
    id: Types.ObjectId,
    oldPrefixLength: number,
    newPrefix: Types.ObjectId[],
  ): Promise<void> {
    await this.model
      .updateMany(
        { ancestors: id },
        [
          {
            $set: {
              ancestors: {
                $concatArrays: [
                  newPrefix,
                  {
                    $slice: ['$ancestors', oldPrefixLength, MAX_CATEGORY_DEPTH],
                  },
                ],
              },
            },
          },
        ],
        // Pipelines aren't cast by Mongoose: every value above is an ObjectId
        // or a number built by this service.
        { updatePipeline: true },
      )
      .exec();
  }
}
