import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthUser } from '../../auth/auth.types';
import { Paginated, toPage } from '../../common/types/paginated';
import { escapeRegex } from '../../common/utils/regex';
import { NAME_COLLATION } from '../categories/schemas/category.schema';
import { parseSort, resolveSlug, rethrowDuplicate } from '../taxonomy.utils';
import { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tags.dto';
import { Tag } from './schemas/tag.schema';
import { TagRecord, TagView } from './tags.types';

const TAG_PROJECTION = 'name slug createdAt updatedAt';

const DUPLICATE_MESSAGES = {
  slug: 'A tag with this slug already exists',
  name: 'A tag with this name already exists',
};

// The search term is escaped, so no regex or operator can be injected.
export function buildTagListFilter(search?: string): QueryFilter<Tag> {
  return search
    ? { name: { $regex: `^${escapeRegex(search)}`, $options: 'i' } }
    : {};
}

export function toTagView(t: TagRecord): TagView {
  return {
    id: t._id.toHexString(),
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// Tag CRUD. Reads are public; writes are admin-only (enforced by the
// controller) and audited here.
@Injectable()
export class TagsService {
  private readonly audit = new Logger('Audit');

  constructor(@InjectModel(Tag.name) private readonly model: Model<Tag>) {}

  async list(query: ListTagsQueryDto): Promise<Paginated<TagView>> {
    const { page, limit } = query;
    const filter = buildTagListFilter(query.search);
    const find = this.model
      .find(filter)
      .select(TAG_PROJECTION)
      .sort(parseSort(query.sort))
      .skip((page - 1) * limit)
      .limit(limit);
    // Same collation as the unique name index: case-insensitive ordering,
    // served by that index.
    if (query.sort === 'name' || query.sort === '-name') {
      find.collation(NAME_COLLATION);
    }

    const [items, total] = await Promise.all([
      find.lean<TagRecord[]>().exec(),
      query.search
        ? this.model.countDocuments(filter).exec()
        : this.model.estimatedDocumentCount().exec(),
    ]);
    return toPage(items.map(toTagView), total, page, limit);
  }

  async getById(id: Types.ObjectId): Promise<TagView> {
    return toTagView(await this.findOrThrow({ _id: id }));
  }

  async getBySlug(slug: string): Promise<TagView> {
    return toTagView(await this.findOrThrow({ slug }));
  }

  // Used by content modules to resolve `?tag=<slug>` filters.
  async findIdBySlug(slug: string): Promise<Types.ObjectId | null> {
    const tag = await this.model
      .findOne({ slug })
      .select('_id')
      .lean<Pick<TagRecord, '_id'>>()
      .exec();
    return tag?._id ?? null;
  }

  // Used by content modules to check that every referenced tag exists.
  countExisting(ids: Types.ObjectId[]): Promise<number> {
    return this.model.countDocuments({ _id: { $in: ids } }).exec();
  }

  async create(actor: AuthUser, dto: CreateTagDto): Promise<TagView> {
    const slug = resolveSlug(dto.slug, dto.name);
    let created: TagRecord;
    try {
      // Explicit field mapping: the DTO is never spread into the document.
      const doc = await this.model.create({ name: dto.name, slug });
      created = doc.toObject<TagRecord>();
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }
    this.audit.log(
      `tag.created actor=${actor.id} id=${created._id.toHexString()} slug=${created.slug}`,
    );
    return toTagView(created);
  }

  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateTagDto,
  ): Promise<TagView> {
    const current = await this.findOrThrow({ _id: id });

    const $set: Partial<Pick<Tag, 'name' | 'slug'>> = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      $set.name = dto.name;
    }
    if (dto.slug !== undefined && dto.slug !== current.slug) {
      $set.slug = dto.slug;
    }
    if (Object.keys($set).length === 0) return toTagView(current);

    let updated: TagRecord | null;
    try {
      updated = await this.model
        .findByIdAndUpdate(
          id,
          { $set },
          { returnDocument: 'after', runValidators: true },
        )
        .select(TAG_PROJECTION)
        .lean<TagRecord>()
        .exec();
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }
    if (!updated) throw new NotFoundException('Tag not found');

    this.audit.log(
      `tag.updated actor=${actor.id} id=${id.toHexString()} changes=${Object.keys($set).join(',')}`,
    );
    return toTagView(updated);
  }

  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const deleted = await this.model
      .findOneAndDelete({ _id: id })
      .select('slug')
      .lean<Pick<TagRecord, '_id' | 'slug'>>()
      .exec();
    if (!deleted) throw new NotFoundException('Tag not found');
    this.audit.log(
      `tag.deleted actor=${actor.id} id=${id.toHexString()} slug=${deleted.slug}`,
    );
  }

  private async findOrThrow(filter: QueryFilter<Tag>): Promise<TagRecord> {
    const tag = await this.model
      .findOne(filter)
      .select(TAG_PROJECTION)
      .lean<TagRecord>()
      .exec();
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }
}
