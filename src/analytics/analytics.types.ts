import { ArticleSummaryView } from '../articles/articles.types';
import { ArticleStatus } from '../articles/schemas/article.schema';
import { SubscriberStats } from '../newsletter/newsletter.types';
import { VideoStatus } from '../videos/schemas/video.schema';
import { VideoSummaryView } from '../videos/videos.types';
import { ContentType } from './schemas/daily-stat.schema';

export interface PopularItem<T> {
  views: number;
  item: T;
}

export interface PopularView {
  type: ContentType;
  days: number;
  items: PopularItem<ArticleSummaryView | VideoSummaryView>[];
}

export interface TopContent {
  id: string;
  title: string;
  slug: string;
  views: number;
}

export interface DailyViews {
  day: string;
  ARTICLE: number;
  VIDEO: number;
}

export interface OverviewView {
  from: string;
  to: string;
  totals: Record<ContentType, number>;
  daily: DailyViews[];
  topArticles: TopContent[];
  topVideos: TopContent[];
  content: {
    articles: Record<ArticleStatus, number>;
    videos: Record<VideoStatus, number>;
  };
  newsletter: SubscriberStats;
}
