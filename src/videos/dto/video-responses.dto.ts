import { ApiProperty } from '@nestjs/swagger';
import {
  AuthorResponse,
  TaxonomyRefResponse,
} from '../../articles/dto/article-responses.dto';
import { VideoStatus } from '../schemas/video.schema';
import { VideoProvider } from '../video-url';

// Swagger-only response shapes.

export class VideoSummaryResponse {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty({ enum: VideoProvider }) provider: VideoProvider;
  @ApiProperty() providerVideoId: string;
  @ApiProperty() watchUrl: string;
  @ApiProperty({ description: 'Privacy-enhanced player URL for an iframe' })
  embedUrl: string;
  @ApiProperty({ type: String, nullable: true }) thumbnailUrl: string | null;
  @ApiProperty({ type: Number, nullable: true })
  durationSeconds: number | null;
  @ApiProperty({ type: AuthorResponse, nullable: true })
  author: AuthorResponse | null;
  @ApiProperty({ type: TaxonomyRefResponse, nullable: true })
  category: TaxonomyRefResponse | null;
  @ApiProperty({ type: [TaxonomyRefResponse] }) tags: TaxonomyRefResponse[];
  @ApiProperty({ enum: VideoStatus }) status: VideoStatus;
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class VideoResponse extends VideoSummaryResponse {
  @ApiProperty({ description: 'Plain text' }) description: string;
}

export class PaginatedVideosResponse {
  @ApiProperty({ type: [VideoSummaryResponse] }) items: VideoSummaryResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
