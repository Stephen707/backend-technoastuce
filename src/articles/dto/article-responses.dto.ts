import { ApiProperty } from '@nestjs/swagger';
import { ArticleStatus } from '../schemas/article.schema';

// Swagger-only response shapes.

export class AuthorResponse {
  @ApiProperty() id: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

export class TaxonomyRefResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class CoverImageResponse {
  @ApiProperty() url: string;
  @ApiProperty({ type: String, nullable: true }) alt: string | null;
}

export class ArticleSummaryResponse {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty() excerpt: string;
  @ApiProperty({ type: CoverImageResponse, nullable: true })
  coverImage: CoverImageResponse | null;
  @ApiProperty({ type: AuthorResponse, nullable: true })
  author: AuthorResponse | null;
  @ApiProperty({ type: TaxonomyRefResponse, nullable: true })
  category: TaxonomyRefResponse | null;
  @ApiProperty({ type: [TaxonomyRefResponse] }) tags: TaxonomyRefResponse[];
  @ApiProperty({ enum: ArticleStatus }) status: ArticleStatus;
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiProperty() readingTimeMinutes: number;
  @ApiProperty() commentsEnabled: boolean;
  @ApiProperty() commentCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ArticleResponse extends ArticleSummaryResponse {
  @ApiProperty({ description: 'Sanitized HTML' }) content: string;
}

export class PaginatedArticlesResponse {
  @ApiProperty({ type: [ArticleSummaryResponse] })
  items: ArticleSummaryResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
