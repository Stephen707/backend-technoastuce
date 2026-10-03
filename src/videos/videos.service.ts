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
import { TaxonomyRef, TaxonomyRefRecord } from '../articles/articles.types';
import type { AuthUser } from '../auth/auth.types';
import { CacheNamespace } from '../cache/cache.constants';
import { CacheService, hashKey } from '../cache/cache.service';
import { Paginated, toPage } from '../common/types/paginated';
import { CategoriesService } from '../taxonomy/categories/categories.service';
import { TagsService } from '../taxonomy/tags/tags.service';
import {
  parseSort,
  resolveSlug,
  rethrowDuplicate,
} from '../taxonomy/taxonomy.utils';
import { AUTHOR_PROJECTION, toAuthorView } from '../users/author-view';
import {
  AdminListVideosQueryDto,
  CreateVideoDto,
  ListVideosQueryDto,
  UpdateVideoDto,
} from './dto/videos.dto';
import { Video, VideoStatus } from './schemas/video.schema';
import {
  defaultThumbnailUrl,
  embedUrl,
  parseVideoUrl,
  ParsedVideo,
  watchUrl,
} from './video-url';
import { VideoRecord, VideoSummaryView, VideoView } from './videos.types';

const SUMMARY_PROJECTION =
  'title slug provider providerVideoId thumbnailUrl durationSeconds author category tags status publishedAt createdAt updatedAt';
const DETAIL_PROJECTION = `${SUMMARY_PROJECTION} description`;

const REF_POPULATE: PopulateOptions[] = [
  { path: 'author', select: AUTHOR_PROJECTION },
  { path: 'category', select: 'name slug' },
  { path: 'tags', select: 'name slug' },
];

const DUPLICATE_MESSAGES = {
  slug: 'A video with this slug already exists',
  providerVideoId: 'This video has already been added',
};

type VideoFields = Pick<
  Video,
  | 'title'
  | 'slug'
  | 'description'
  | 'provider'
  | 'providerVideoId'
  | 'thumbnailUrl'
  | 'durationSeconds'
  | 'category'
  | 'tags'
  | 'status'
  | 'publishedAt'
>;

export function publicVideoFilter(now = new Date()): QueryFilter<Video> {
  return { status: VideoStatus.PUBLISHED, publishedAt: { $lte: now } };
}

export function resolveVideoPublishedAt(
  status: VideoStatus,
  publishedAt: Date | null | undefined,
  now = new Date(),
): Date | null {
  if (publishedAt) return publishedAt;
  return status === VideoStatus.PUBLISHED ? now : null;
}

// The DTO validated the URL already; this only narrows the type.
function parseValidatedUrl(url: string): ParsedVideo {
  const parsed = parseVideoUrl(url);
  if (!parsed) throw new BadRequestException('Unsupported video URL');
  return parsed;
}

function toTaxonomyRef(r: TaxonomyRefRecord): TaxonomyRef {
  return { id: r._id.toHexString(), name: r.name, slug: r.slug };
}

export function toVideoSummaryView(v: VideoRecord): VideoSummaryView {
  return {
    id: v._id.toHexString(),
    title: v.title,
    slug: v.slug,
    provider: v.provider,
    providerVideoId: v.providerVideoId,
    watchUrl: watchUrl(v.provider, v.providerVideoId),
    embedUrl: embedUrl(v.provider, v.providerVideoId),
    thumbnailUrl:
      v.thumbnailUrl ?? defaultThumbnailUrl(v.provider, v.providerVideoId),
    durationSeconds: v.durationSeconds,
    author: toAuthorView(v.author),
    category: v.category ? toTaxonomyRef(v.category) : null,
    tags: v.tags.flatMap((t) => (t ? [toTaxonomyRef(t)] : [])),
    status: v.status,
    publishedAt: v.publishedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export function toVideoView(v: VideoRecord): VideoView {
  return { ...toVideoSummaryView(v), description: v.description ?? '' };
}

function sameIds(a: Types.ObjectId[], b: Types.ObjectId[]): boolean {
  return a.length === b.length && a.every((id, i) => id.equals(b[i]));
}

/**
 * Video CRUD, same rules as articles: public reads only see published
 * videos (and are cached, see CacheService), writes are admin-only
 * (controller) and audited, refs are populated with one query per path.
 */
@Injectable()
export class VideosService {
  private readonly audit = new Logger('Audit');

  constructor(
    @InjectModel(Video.name) private readonly model: Model<Video>,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
    private readonly cache: CacheService,
  ) {}

  // ----------------------------------------------------------------- public

  listPublished(query: ListVideosQueryDto): Promise<Paginated<VideoSummaryView>> {
    return this.cache.getOrSet(
      CacheNamespace.VIDEOS,
      `list:${hashKey(query)}`,
      async () => {
        const { page, limit } = query;
        const filter = publicVideoFilter();
        if (query.category) {
          const ids = await this.categories.findSubtreeIdsBySlug(
            query.category,
          );
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
      },
    );
  }

  async getPublishedBySlug(slug: string): Promise<VideoView> {
    const video = await this.cache.getOrSet(
      CacheNamespace.VIDEOS,
      `slug:${slug}`,
      async () => {
        const v = await this.findOne(
          { ...publicVideoFilter(), slug },
          DETAIL_PROJECTION,
        );
        return v ? toVideoView(v) : null;
      },
    );
    if (!video) throw new NotFoundException('Video not found');
    return video;
  }

  // ------------------------------------------------------------------ admin

  listAll(query: AdminListVideosQueryDto): Promise<Paginated<VideoSummaryView>> {
    const filter: QueryFilter<Video> = {};
    if (query.status) filter.status = query.status;
    if (query.provider) filter.provider = query.provider;
    if (query.search) filter.$text = { $search: query.search };
    return this.findPage(filter, query.sort, query.page, query.limit);
  }

  async getById(id: Types.ObjectId): Promise<VideoView> {
    const video = await this.findOne({ _id: id }, DETAIL_PROJECTION);
    if (!video) throw new NotFoundException('Video not found');
    return toVideoView(video);
  }

  async create(actor: AuthUser, dto: CreateVideoDto): Promise<VideoView> {
    const slug = resolveSlug(dto.slug, dto.title);
    const parsed = parseValidatedUrl(dto.url);
    const category = await this.resolveCategory(dto.categoryId);
    const tags = await this.resolveTags(dto.tagIds ?? []);
    const status = dto.status ?? VideoStatus.DRAFT;

    let id: Types.ObjectId;
    try {
      const doc = await this.model.create({
        title: dto.title,
        slug,
        description: dto.description ?? '',
        provider: parsed.provider,
        providerVideoId: parsed.id,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        durationSeconds: dto.durationSeconds ?? null,
        author: new Types.ObjectId(actor.id),
        category,
        tags,
        status,
        publishedAt: resolveVideoPublishedAt(status, dto.publishedAt),
      });
      id = doc._id;
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }

    await this.cache.invalidate(CacheNamespace.VIDEOS);
    this.audit.log(
      `video.created actor=${actor.id} id=${id.toHexString()} slug=${slug} status=${status}`,
    );
    return this.getById(id);
  }

  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateVideoDto,
  ): Promise<VideoView> {
    const current = await this.model
      .findById(id)
      .select(
        'title slug description provider providerVideoId thumbnailUrl durationSeconds category tags status publishedAt',
      )
      .lean<Pick<VideoRecord, '_id'> & VideoFields>()
      .exec();
    if (!current) throw new NotFoundException('Video not found');

    const $set: Partial<VideoFields> = {};
    const setIfChanged = <K extends keyof VideoFields>(
      key: K,
      value: VideoFields[K] | undefined,
    ) => {
      if (value !== undefined && value !== current[key]) $set[key] = value;
    };

    setIfChanged('title', dto.title);
    setIfChanged('slug', dto.slug);
    setIfChanged('description', dto.description);
    setIfChanged('thumbnailUrl', dto.thumbnailUrl);
    setIfChanged('durationSeconds', dto.durationSeconds);
    if (dto.url !== undefined) {
      const parsed = parseValidatedUrl(dto.url);
      setIfChanged('provider', parsed.provider);
      setIfChanged('providerVideoId', parsed.id);
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
    setIfChanged('status', status);
    const publishedAt = resolveVideoPublishedAt(
      status,
      dto.publishedAt !== undefined ? dto.publishedAt : current.publishedAt,
    );
    if (publishedAt?.getTime() !== current.publishedAt?.getTime()) {
      $set.publishedAt = publishedAt;
    }

    const changed = Object.keys($set);
    if (changed.length === 0) return this.getById(id);

    try {
      const res = await this.model
        .updateOne({ _id: id }, { $set } as UpdateQuery<Video>, {
          runValidators: true,
        })
        .exec();
      if (res.matchedCount === 0) throw new NotFoundException('Video not found');
    } catch (err) {
      rethrowDuplicate(err, DUPLICATE_MESSAGES);
    }

    await this.cache.invalidate(CacheNamespace.VIDEOS);
    this.audit.log(
      `video.updated actor=${actor.id} id=${id.toHexString()} changes=${changed.join(',')}`,
    );
    return this.getById(id);
  }

  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const deleted = await this.model
      .findOneAndDelete({ _id: id })
      .select('slug')
      .lean<Pick<VideoRecord, '_id' | 'slug'>>()
      .exec();
    if (!deleted) throw new NotFoundException('Video not found');
    await this.cache.invalidate(CacheNamespace.VIDEOS);
    this.audit.log(
      `video.deleted actor=${actor.id} id=${id.toHexString()} slug=${deleted.slug}`,
    );
  }

  // ------------------------------------------------ used by AnalyticsService

  async isPublic(id: Types.ObjectId): Promise<boolean> {
    return (await this.model.exists({ ...publicVideoFilter(), _id: id })) !== null;
  }

  // Public videos among `ids`, in the order of `ids` (one query).
  async findPublicSummaries(ids: Types.ObjectId[]): Promise<VideoSummaryView[]> {
    if (ids.length === 0) return [];
    const items = await this.model
      .find({ ...publicVideoFilter(), _id: { $in: ids } })
      .select(SUMMARY_PROJECTION)
      .populate(REF_POPULATE)
      .lean<VideoRecord[]>()
      .exec();
    const byId = new Map(items.map((v) => [v._id.toHexString(), v]));
    return ids.flatMap((id) => {
      const v = byId.get(id.toHexString());
      return v ? [toVideoSummaryView(v)] : [];
    });
  }

  countByStatus(): Promise<{ _id: VideoStatus; count: number }[]> {
    return this.model
      .aggregate<{ _id: VideoStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
  }

  // --------------------------------------------------------------- helpers

  private async findPage(
    filter: QueryFilter<Video>,
    sort: string,
    page: number,
    limit: number,
  ): Promise<Paginated<VideoSummaryView>> {
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(SUMMARY_PROJECTION)
        .sort(parseSort(sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(REF_POPULATE)
        .lean<VideoRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPage(items.map(toVideoSummaryView), total, page, limit);
  }

  private findOne(
    filter: QueryFilter<Video>,
    projection: string,
  ): Promise<VideoRecord | null> {
    return this.model
      .findOne(filter)
      .select(projection)
      .populate(REF_POPULATE)
      .lean<VideoRecord>()
      .exec();
  }

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
