import { ApiProperty } from '@nestjs/swagger';
import { ArticleSummaryResponse } from '../../articles/dto/article-responses.dto';
import { SubscriberStatsResponse } from '../../newsletter/dto/newsletter-responses.dto';
import { VideoSummaryResponse } from '../../videos/dto/video-responses.dto';
import { ContentType } from '../schemas/daily-stat.schema';

// Swagger-only response shapes.

export class PopularItemResponse {
  @ApiProperty({ description: 'Unique visitors over the period' })
  views: number;

  @ApiProperty({
    oneOf: [
      { $ref: '#/components/schemas/ArticleSummaryResponse' },
      { $ref: '#/components/schemas/VideoSummaryResponse' },
    ],
  })
  item: ArticleSummaryResponse | VideoSummaryResponse;
}

export class PopularResponse {
  @ApiProperty({ enum: ContentType }) type: ContentType;
  @ApiProperty() days: number;
  @ApiProperty({ type: [PopularItemResponse] }) items: PopularItemResponse[];
}

export class TopContentResponse {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty() views: number;
}

export class DailyViewsResponse {
  @ApiProperty({ example: '2026-09-30' }) day: string;
  @ApiProperty() ARTICLE: number;
  @ApiProperty() VIDEO: number;
}

class ViewTotalsResponse {
  @ApiProperty() ARTICLE: number;
  @ApiProperty() VIDEO: number;
}

class StatusCountsResponse {
  @ApiProperty() DRAFT: number;
  @ApiProperty() PUBLISHED: number;
  @ApiProperty() ARCHIVED: number;
}

class ContentCountsResponse {
  @ApiProperty({ type: StatusCountsResponse }) articles: StatusCountsResponse;
  @ApiProperty({ type: StatusCountsResponse }) videos: StatusCountsResponse;
}

export class OverviewResponse {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: ViewTotalsResponse }) totals: ViewTotalsResponse;
  @ApiProperty({ type: [DailyViewsResponse] }) daily: DailyViewsResponse[];
  @ApiProperty({ type: [TopContentResponse] }) topArticles: TopContentResponse[];
  @ApiProperty({ type: [TopContentResponse] }) topVideos: TopContentResponse[];
  @ApiProperty({ type: ContentCountsResponse }) content: ContentCountsResponse;
  @ApiProperty({ type: SubscriberStatsResponse })
  newsletter: SubscriberStatsResponse;
}
