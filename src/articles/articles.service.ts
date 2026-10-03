import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  PopulateOptions,
  QueryFilter,
  Types,
  UpdateQuery,
} from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { CacheNamespace } from '../cache/cache.constants';
import { CacheService, hashKey } from '../cache/cache.service';
import { Comment } from '../comments/schemas/comment.schema';
import { Paginated, toPage } from '../common/types/paginated';
import {
  readingTimeMinutes,
  richTextToPlainText,
  truncatePlainText,
} from '../common/utils/rich-text';
import { CategoriesService } from '../taxonomy/categories/categories.service';
import { TagsService } from '../taxonomy/tags/tags.service';
import {
  parseSort,
  resolveSlug,
  rethrowDuplicate,
} from '../taxonomy/taxonomy.utils';
import { AUTHOR_PROJECTION, toAuthorView } from '../users/author-view';
import {
  ArticleRecord,
  ArticleSummaryView,
  ArticleView,
  CommentTarget,
  TaxonomyRef,
  TaxonomyRefRecord,
} from './articles.types';
import {
  AdminListArticlesQueryDto,
  CoverImageDto,
  CreateArticleDto,
  ListArticlesQueryDto,
  UpdateArticleDto,
} from './dto/articles.dto';
import { Article, ArticleStatus } from './schemas/article.schema';

const SUMMARY_PROJECTION =
  'title slug excerpt coverImage author category tags status publishedAt readingTimeMinutes commentsEnabled commentCount createdAt updatedAt';
const DETAIL_PROJECTION = `${SUMMARY_PROJECTION} content`;

// Derived excerpts are a bit shorter than the 300-char limit for typed ones.
const DERIVED_EXCERPT_LENGTH = 200;

// One `$in` query per ref path for a whole page (no N+1). Only public
// fields of the author are read, never the email.
const REF_POPULATE: PopulateOptions[] = [
  { path: 'author', select: AUTHOR_PROJECTION },
  { path: 'category', select: 'name slug' },
  { path: 'tags', select: 'name slug' },
];

const DUPLICATE_MESSAGES = { slug: 'An article with this slug already exists' };

type ArticleFields = Pick<
  Article,
  | 'title'
  | 'slug'
  | 'excerpt'
  | 'content'
  | 'readingTimeMinutes'
  | 'coverImage'
  | 'category'
  | 'tags'
  | 'status'
  | 'publishedAt'
  | 'commentsEnabled'
>;

// What anonymous visitors may see: published, and not scheduled for later.
export function publicArticleFilter(now = new Date()): QueryFilter<Article> {
  return { status: ArticleStatus.PUBLISHED, publishedAt: { $lte: now } };
}

/**
 * A published article without a date gets one now; otherwise the date is
 * kept (including a future one, which schedules the article).
 */
export function resolvePublishedAt(
  status: ArticleStatus,
  publishedAt: Date | null | undefined,
  now = new Date(),
): Date | null {
  if (publishedAt) return publishedAt;
  return status === ArticleStatus.PUBLISHED ? now : null;
}

// Excerpt and reading time follow the (already sanitized) content.
export function deriveFromContent(content: string): {
  text: string;
  excerpt: string;
  readingTimeMinutes: number;
} {
  const text = richTextToPlainText(content);
  return {
    text,
    excerpt: truncatePlainText(text, DERIVED_EXCERPT_LENGTH),
    readingTimeMinutes: readingTimeMinutes(text),
  };
}

function toTaxonomyRef(r: TaxonomyRefRecord): TaxonomyRef {
  return { id: r._id.toHexString(), name: r.name, slug: r.slug };
}

function toCover(dto: CoverImageDto): Article['coverImage'] {
  return dto.alt ? { url: dto.url, alt: dto.alt } : { url: dto.url };
}

export function toArticleSummaryView(a: ArticleRecord): ArticleSummaryView {
  return {
    id: a._id.toHexString(),
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    coverImage: a.coverImage
      ? { url: a.coverImage.url, alt: a.coverImage.alt ?? null }
      : null,
    author: toAuthorView(a.author),
    category: a.category ? toTaxonomyRef(a.category) : null,
    // Deleted tags leave a null behind until the article is saved again.
    tags: a.tags.flatMap((t) => (t ? [toTaxonomyRef(t)] : [])),
    status: a.status,
    publishedAt: a.publishedAt,
    readingTimeMinutes: a.readingTimeMinutes,
    commentsEnabled: a.commentsEnabled,
    commentCount: a.commentCount,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function toArticleView(a: ArticleRecord): ArticleView {
  return { ...toArticleSummaryView(a), content: a.content ?? '' };
}

function sameIds(a: Types.ObjectId[], b: Types.ObjectId[]): boolean {
  return a.length === b.length && a.every((id, i) => id.equals(b[i]));
}

/**
 * Article CRUD. Public reads only ever see published articles; writes are
 * admin-only (enforced by the controller) and audited here. Author,
 * category and tags are resolved with one batched query per path (no N+1),
 * and listings never load the article body.
 */
@Injectable()
export class ArticlesService {
  private readonly audit = new Logger('Audit');

  constructor(
    @InjectModel(Article.name) private readonly model: Model<Article>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
    private readonly cache: CacheService,
  ) {}

  // ----------------------------------------------------------------- public

  // Public reads are cached (see CacheService) and invalidated by every
  // write below, including comment count changes.
  listPublished(
    query: ListArticlesQueryDto,
  ): Promise<Paginated<ArticleSummaryView>> {
    return this.cache.getOrSet(
      CacheNamespace.ARTICLES,
      `list:${hashKey(query)}`,
      () => this.loadPublished(query),
    );
  }

  private async loadPublished(
    query: ListArticlesQueryDto,
  ): Promise<Paginated<ArticleSummaryView>> {
    const { page, limit } = query;
    const filter = publicArticleFilter();
    if (query.category) {
      const ids = await this.categories.findSubtreeIdsBySlug(query.category);
      if (!ids) return toPage([], 0, page, limit);
      filter.category = { $in: ids };
    }
    if (query.tag) {
      const id = await this.tags.findIdBySlug(query.tag);
      if (!id) return toPage([], 0, page, limit);
      filter.tags = id;
    }
    if (query.search) filter.$text = { $search: query.search };
    return this.findPage(filter, query.sort, page, limit);
  }

  async getPublishedBySlug(slug: string): Promise<ArticleView> {
    const article = await this.cache.getOrSet(
      CacheNamespace.ARTICLES,
      `slug:${slug}`,
      async () => {
        const a = await this.findOne(
          { ...publicArticleFilter(), slug },
          DETAIL_PROJECTION,
        );
        return a ? toArticleView(a) : null;
      },
    );
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  // ------------------------------------------------------------------ admin

  async listAll(
    query: AdminListArticlesQueryDto,
  ): Promise<Paginated<ArticleSummaryView>> {
    const filter: QueryFilter<Article> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) {
      filter.category = new Types.ObjectId(query.categoryId);
    }
    if (query.tagId) filter.tags = new Types.ObjectId(query.tagId);
    if (query.search) filter.$text = { $search: query.search };
    return this.findPage(filter, query.sort, query.page, query.limit);
  }

  async getById(id: Types.ObjectId): Promise<ArticleView> {
    const article = await this.findOne({ _id: id }, DETAIL_PROJECTION);
    if (!article) throw new NotFoundException('Article not found');
    return toArticleView(article);
  }

  async create(actor: AuthUser, dto: CreateArticleDto): Promise<ArticleView> {
    const slug = resolveSlug(dto.slug, dto.title);
    const derived = deriveFromContent(dto.content);
    const category = await this.resolveCategory(dto.categoryId);
    const tags = await this.resolveTags(dto.tagIds ?? []);
    const status = dto.status ?? ArticleStatus.DRAFT;

    let id: Types.ObjectId;
    try {
      // Explicit field mapping: the DTO is never spread into the document.
      const doc = await this.model.create({
        title: dto.title,
        slug,
        excerpt: dto.excerpt || derived.excerpt,
        content: dto.content,
        readingTimeMinutes: derived.readingTimeMinutes,
        coverImage: dto.coverImage ? toCover(dto.coverImage) : null,
        author: new Types.ObjectId(actor.id),
        category,
        tags,
        status,
        publishedAt: resolvePublishedAt(status, dto.publishedAt),
        commentsEnabled: dto.commentsEnabled ?? true,
      });
      id = doc._id;
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }

    await this.cache.invalidate(CacheNamespace.ARTICLES);
    this.audit.log(
      `article.created actor=${actor.id} id=${id.toHexString()} slug=${slug} status=${status}`,
    );
    return this.getById(id);
  }

  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateArticleDto,
  ): Promise<ArticleView> {
    const current = await this.model
      .findById(id)
      .select(
        'title slug excerpt content coverImage category tags status publishedAt commentsEnabled',
      )
      .lean<
        Pick<ArticleRecord, '_id' | 'coverImage' | 'status'> & ArticleFields
      >()
      .exec();
    if (!current) throw new NotFoundException('Article not found');

    const $set: Partial<ArticleFields> = {};
    if (dto.title !== undefined && dto.title !== current.title) {
      $set.title = dto.title;
    }
    if (dto.slug !== undefined && dto.slug !== current.slug) {
      $set.slug = dto.slug;
    }

    const content = dto.content ?? current.content;
    if (dto.content !== undefined && dto.content !== current.content) {
      $set.content = dto.content;
      $set.readingTimeMinutes = deriveFromContent(content).readingTimeMinutes;
    }
    if (dto.excerpt !== undefined) {
      const excerpt = dto.excerpt || deriveFromContent(content).excerpt;
      if (excerpt !== current.excerpt) $set.excerpt = excerpt;
    }

    if (dto.coverImage !== undefined) {
      const cover = dto.coverImage ? toCover(dto.coverImage) : null;
      if (JSON.stringify(cover) !== JSON.stringify(current.coverImage)) {
        $set.coverImage = cover;
      }
    }
    if (dto.categoryId !== undefined) {
      const category = await this.resolveCategory(dto.categoryId ?? undefined);
      const unchanged =
        category === null || current.category === null
          ? category === current.category
          : category.equals(current.category);
      if (!unchanged) $set.category = category;
    }
    if (dto.tagIds !== undefined) {
      const tags = await this.resolveTags(dto.tagIds);
      if (!sameIds(tags, current.tags)) $set.tags = tags;
    }

    const status = dto.status ?? current.status;
    if (status !== current.status) $set.status = status;
    const publishedAt = resolvePublishedAt(
      status,
      dto.publishedAt !== undefined ? dto.publishedAt : current.publishedAt,
    );
    if (publishedAt?.getTime() !== current.publishedAt?.getTime()) {
      $set.publishedAt = publishedAt;
    }

    if (
      dto.commentsEnabled !== undefined &&
      dto.commentsEnabled !== current.commentsEnabled
    ) {
      $set.commentsEnabled = dto.commentsEnabled;
    }

    const changed = Object.keys($set).filter((k) => k !== 'readingTimeMinutes');
    if (changed.length === 0) return this.getById(id);

    try {
      const res = await this.model
        .updateOne({ _id: id }, { $set } as UpdateQuery<Article>, {
          runValidators: true,
        })
        .exec();
      if (res.matchedCount === 0) {
        throw new NotFoundException('Article not found');
      }
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }

    await this.cache.invalidate(CacheNamespace.ARTICLES);
    this.audit.log(
      `article.updated actor=${actor.id} id=${id.toHexString()} changes=${changed.join(',')}`,
    );
    return this.getById(id);
  }

  // Deletes the article and every comment on it.
  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const deleted = await this.model
      .findOneAndDelete({ _id: id })
      .select('slug')
      .lean<Pick<ArticleRecord, '_id' | 'slug'>>()
      .exec();
    if (!deleted) throw new NotFoundException('Article not found');
    const { deletedCount } = await this.comments
      .deleteMany({ article: id })
      .exec();
    await this.cache.invalidate(CacheNamespace.ARTICLES);
    this.audit.log(
      `article.deleted actor=${actor.id} id=${id.toHexString()} slug=${deleted.slug} comments=${deletedCount}`,
    );
  }

  // ------------------------------------------------- used by CommentsService

  // The article if the public can see (and so comment on) it, else null.
  findCommentTarget(id: Types.ObjectId): Promise<CommentTarget | null> {
    return this.model
      .findOne({ ...publicArticleFilter(), _id: id })
      .select('commentsEnabled')
      .lean<CommentTarget>()
      .exec();
  }

  // Atomic, and never below zero.
  async adjustCommentCount(id: Types.ObjectId, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.model
      .updateOne(
        { _id: id },
        [
          {
            $set: {
              commentCount: { $max: [0, { $add: ['$commentCount', delta] }] },
            },
          },
        ],
        // Pipelines aren't cast by Mongoose: `delta` is a number from this
        // service's callers, never user input.
        { updatePipeline: true },
      )
      .exec();
    await this.cache.invalidate(CacheNamespace.ARTICLES);
  }

  // ------------------------------------------------ used by AnalyticsService

  async isPublic(id: Types.ObjectId): Promise<boolean> {
    return (
      (await this.model.exists({ ...publicArticleFilter(), _id: id })) !== null
    );
  }

  // Public articles among `ids`, in the order of `ids` (one query).
  async findPublicSummaries(
    ids: Types.ObjectId[],
  ): Promise<ArticleSummaryView[]> {
    if (ids.length === 0) return [];
    const items = await this.model
      .find({ ...publicArticleFilter(), _id: { $in: ids } })
      .select(SUMMARY_PROJECTION)
      .populate(REF_POPULATE)
      .lean<ArticleRecord[]>()
      .exec();
    const byId = new Map(items.map((a) => [a._id.toHexString(), a]));
    return ids.flatMap((id) => {
      const a = byId.get(id.toHexString());
      return a ? [toArticleSummaryView(a)] : [];
    });
  }

  countByStatus(): Promise<{ _id: ArticleStatus; count: number }[]> {
    return this.model
      .aggregate<{ _id: ArticleStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
  }

  // --------------------------------------------------------------- helpers

  private async findPage(
    filter: QueryFilter<Article>,
    sort: string,
    page: number,
    limit: number,
  ): Promise<Paginated<ArticleSummaryView>> {
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(SUMMARY_PROJECTION)
        .sort(parseSort(sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(REF_POPULATE)
        .lean<ArticleRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPage(items.map(toArticleSummaryView), total, page, limit);
  }

  private findOne(
    filter: QueryFilter<Article>,
    projection: string,
  ): Promise<ArticleRecord | null> {
    return this.model
      .findOne(filter)
      .select(projection)
      .populate(REF_POPULATE)
      .lean<ArticleRecord>()
      .exec();
  }

  // References in a body are validation errors (400), not 404s on the route.
  private async resolveCategory(
    categoryId: string | undefined,
  ): Promise<Types.ObjectId | null> {
    if (categoryId === undefined) return null;
    const id = new Types.ObjectId(categoryId);
    if (!(await this.categories.exists(id))) {
      throw new BadRequestException('Category not found');
    }
    return id;
  }

  private async resolveTags(tagIds: string[]): Promise<Types.ObjectId[]> {
    const ids = tagIds.map((t) => new Types.ObjectId(t));
    if (ids.length > 0 && (await this.tags.countExisting(ids)) !== ids.length) {
      throw new BadRequestException('One or more tags were not found');
    }
    return ids;
  }
}
