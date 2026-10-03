import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ArticlesService } from '../articles/articles.service';
import { ArticleStatus } from '../articles/schemas/article.schema';
import type { ClientInfo } from '../auth/auth.types';
import { CacheNamespace } from '../cache/cache.constants';
import { CacheService, hashKey } from '../cache/cache.service';
import { Config } from '../config/configuration';
import { NewsletterService } from '../newsletter/newsletter.service';
import { VideoStatus } from '../videos/schemas/video.schema';
import { VideosService } from '../videos/videos.service';
import {
  OverviewView,
  PopularView,
  TopContent,
} from './analytics.types';
import {
  addDays,
  daysBetween,
  isBot,
  msUntilEndOfUtcDay,
  utcDay,
  visitorHash,
} from './analytics.utils';
import {
  MAX_OVERVIEW_DAYS,
  OverviewQueryDto,
  PopularQueryDto,
  TrackViewDto,
} from './dto/analytics.dto';
import { ContentType, DailyStat } from './schemas/daily-stat.schema';

const POPULAR_TTL_MS = 5 * 60 * 1000;
// "Is this content public?" answers, reused across view pings.
const TARGET_TTL_MS = 5 * 60 * 1000;
const TOP_LIMIT = 10;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

// Fills every status with 0, then the counts found.
function countsByStatus<S extends string>(
  statuses: Record<string, S>,
  rows: { _id: S; count: number }[],
): Record<S, number> {
  const counts = Object.fromEntries(
    Object.values(statuses).map((s) => [s, 0]),
  ) as Record<S, number>;
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

/**
 * Cookieless content analytics: one counter per content and UTC day,
 * counting each visitor once per day (see visitorHash). Only public
 * articles/videos can be counted, bots are ignored, and nothing personal
 * is stored. Reads use the compound index and aggregate in MongoDB.
 */
@Injectable()
export class AnalyticsService {
  private readonly secret: string;

  constructor(
    @InjectModel(DailyStat.name) private readonly model: Model<DailyStat>,
    private readonly articles: ArticlesService,
    private readonly videos: VideosService,
    private readonly newsletter: NewsletterService,
    private readonly cache: CacheService,
    config: ConfigService<Config, true>,
  ) {
    this.secret = `analytics:${config.get('jwtSecret', { infer: true })}`;
  }

  // ----------------------------------------------------------------- public

  async trackView(
    dto: TrackViewDto,
    client: ClientInfo,
    now = new Date(),
  ): Promise<void> {
    if (isBot(client.userAgent)) return;
    const id = new Types.ObjectId(dto.id);
    if (!(await this.isPublicTarget(dto.type, id))) {
      throw new NotFoundException('Content not found');
    }

    const day = utcDay(now);
    const visitor = visitorHash(this.secret, day, client.ip, client.userAgent);
    const first = await this.cache.claim(
      `analytics:seen:${day}:${dto.type}:${dto.id}:${visitor}`,
      msUntilEndOfUtcDay(now),
    );
    if (!first) return;

    const filter = { targetType: dto.type, day, target: id };
    const inc = { $inc: { views: 1 } };
    try {
      await this.model.updateOne(filter, inc, { upsert: true }).exec();
    } catch (err) {
      // Two first views at once: one upsert inserts, the other retries as
      // a plain increment.
      if (!isDuplicateKeyError(err)) throw err;
      await this.model.updateOne(filter, inc).exec();
    }
  }

  popular(query: PopularQueryDto, now = new Date()): Promise<PopularView> {
    return this.cache.getOrSet(
      CacheNamespace.ANALYTICS,
      `popular:${utcDay(now)}:${hashKey(query)}`,
      async () => {
        const from = addDays(utcDay(now), -(query.days - 1));
        // Extra rows in case some content is no longer public.
        const top = await this.topIds(
          query.type,
          from,
          utcDay(now),
          query.limit * 2,
        );
        const summaries =
          query.type === ContentType.ARTICLE
            ? await this.articles.findPublicSummaries(top.map((t) => t._id))
            : await this.videos.findPublicSummaries(top.map((t) => t._id));
        const views = new Map(top.map((t) => [t._id.toHexString(), t.views]));
        return {
          type: query.type,
          days: query.days,
          items: summaries.slice(0, query.limit).map((item) => ({
            views: views.get(item.id) ?? 0,
            item,
          })),
        };
      },
      POPULAR_TTL_MS,
    );
  }

  // ------------------------------------------------------------------ admin

  async overview(
    query: OverviewQueryDto,
    now = new Date(),
  ): Promise<OverviewView> {
    const to = query.to ?? utcDay(now);
    const from = query.from ?? addDays(to, -29);
    if (from > to) {
      throw new BadRequestException('`from` must not be after `to`');
    }
    const days = daysBetween(from, to);
    if (days.length > MAX_OVERVIEW_DAYS) {
      throw new BadRequestException(
        `The range may cover at most ${MAX_OVERVIEW_DAYS} days`,
      );
    }

    const [daily, topArticles, topVideos, articleCounts, videoCounts, subs] =
      await Promise.all([
        this.model
          .aggregate<{ _id: { day: string; type: ContentType }; views: number }>(
            [
              {
                $match: {
                  targetType: { $in: Object.values(ContentType) },
                  day: { $gte: from, $lte: to },
                },
              },
              {
                $group: {
                  _id: { day: '$day', type: '$targetType' },
                  views: { $sum: '$views' },
                },
              },
            ],
          )
          .exec(),
        this.topContent(ContentType.ARTICLE, from, to),
        this.topContent(ContentType.VIDEO, from, to),
        this.articles.countByStatus(),
        this.videos.countByStatus(),
        this.newsletter.stats(),
      ]);

    const byDay = new Map(
      days.map((day) => [day, { day, ARTICLE: 0, VIDEO: 0 }]),
    );
    const totals = { [ContentType.ARTICLE]: 0, [ContentType.VIDEO]: 0 };
    for (const row of daily) {
      const entry = byDay.get(row._id.day);
      if (entry) entry[row._id.type] = row.views;
      totals[row._id.type] += row.views;
    }

    return {
      from,
      to,
      totals,
      daily: [...byDay.values()],
      topArticles,
      topVideos,
      content: {
        articles: countsByStatus(ArticleStatus, articleCounts),
        videos: countsByStatus(VideoStatus, videoCounts),
      },
      newsletter: subs,
    };
  }

  // --------------------------------------------------------------- helpers

  private topIds(
    type: ContentType,
    from: string,
    to: string,
    limit: number,
  ): Promise<{ _id: Types.ObjectId; views: number }[]> {
    return this.model
      .aggregate<{ _id: Types.ObjectId; views: number }>([
        { $match: { targetType: type, day: { $gte: from, $lte: to } } },
        { $group: { _id: '$target', views: { $sum: '$views' } } },
        { $sort: { views: -1, _id: 1 } },
        { $limit: limit },
      ])
      .exec();
  }

  // Top content of the period that is still public, with title and slug.
  private async topContent(
    type: ContentType,
    from: string,
    to: string,
  ): Promise<TopContent[]> {
    const top = await this.topIds(type, from, to, TOP_LIMIT);
    const ids = top.map((t) => t._id);
    const summaries =
      type === ContentType.ARTICLE
        ? await this.articles.findPublicSummaries(ids)
        : await this.videos.findPublicSummaries(ids);
    const views = new Map(top.map((t) => [t._id.toHexString(), t.views]));
    return summaries.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      views: views.get(s.id) ?? 0,
    }));
  }

  private isPublicTarget(
    type: ContentType,
    id: Types.ObjectId,
  ): Promise<boolean> {
    return this.cache.getOrSet(
      CacheNamespace.ANALYTICS,
      `target:${type}:${id.toHexString()}`,
      () =>
        type === ContentType.ARTICLE
          ? this.articles.isPublic(id)
          : this.videos.isPublic(id),
      TARGET_TTL_MS,
    );
  }
}
