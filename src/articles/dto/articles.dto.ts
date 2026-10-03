import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinDate,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug';
import {
  IsOptionalNotNull,
  IsPlainText,
  IsSlug,
} from '../../taxonomy/taxonomy.validation';
import { IsRichText, IsSingleLineText } from '../articles.validation';
import {
  ARTICLE_CONTENT_MAX_LENGTH,
  ARTICLE_EXCERPT_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
  ARTICLE_TITLE_MIN_LENGTH,
  ArticleStatus,
  COVER_ALT_MAX_LENGTH,
  COVER_URL_MAX_LENGTH,
  MAX_TAGS_PER_ARTICLE,
} from '../schemas/article.schema';

export const PUBLIC_ARTICLE_SORTS = ['-publishedAt', 'publishedAt'] as const;
export type PublicArticleSort = (typeof PUBLIC_ARTICLE_SORTS)[number];

export const ADMIN_ARTICLE_SORTS = [
  '-createdAt',
  'createdAt',
  '-updatedAt',
  '-publishedAt',
  'publishedAt',
  'title',
  '-title',
] as const;
export type AdminArticleSort = (typeof ADMIN_ARTICLE_SORTS)[number];

const SEARCH_MAX_LENGTH = 100;
const EARLIEST_PUBLISH_DATE = new Date('2000-01-01T00:00:00Z');

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CoverImageDto {
  @ApiProperty({
    example: 'https://cdn.technoastuce.com/covers/windows-11.webp',
    maxLength: COVER_URL_MAX_LENGTH,
    description: 'Absolute https URL',
  })
  @IsString()
  @MaxLength(COVER_URL_MAX_LENGTH)
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_tld: true,
    disallow_auth: true,
  })
  url: string;

  @ApiPropertyOptional({ maxLength: COVER_ALT_MAX_LENGTH })
  @IsOptional()
  @IsSingleLineText(0, COVER_ALT_MAX_LENGTH)
  alt?: string;
}

// Explicit fields only: anything else (author, commentCount, _id, ...) is
// rejected by the global whitelist pipe, and the service maps each field by
// hand.
export class CreateArticleDto {
  @ApiProperty({
    example: 'Désactiver la télémétrie de Windows 11',
    minLength: ARTICLE_TITLE_MIN_LENGTH,
    maxLength: ARTICLE_TITLE_MAX_LENGTH,
  })
  @IsSingleLineText(ARTICLE_TITLE_MIN_LENGTH, ARTICLE_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    description: 'Derived from the title when omitted',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: ARTICLE_EXCERPT_MAX_LENGTH,
    description: 'Plain text; derived from the content when omitted',
  })
  @IsOptionalNotNull()
  @IsPlainText(ARTICLE_EXCERPT_MAX_LENGTH)
  excerpt?: string;

  @ApiProperty({
    maxLength: ARTICLE_CONTENT_MAX_LENGTH,
    description:
      'HTML from the editor. Sanitized against an allowlist (headings, lists, links, code, https images, tables); everything else is removed.',
  })
  @IsRichText(ARTICLE_CONTENT_MAX_LENGTH)
  content: string;

  @ApiPropertyOptional({ type: CoverImageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoverImageDto)
  coverImage?: CoverImageDto;

  @ApiPropertyOptional({ description: 'Category id' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS_PER_ARTICLE,
    description: 'Tag ids',
  })
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_ARTICLE)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ enum: ArticleStatus, default: ArticleStatus.DRAFT })
  @IsOptionalNotNull()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Publication date; defaults to now when published. A future date schedules the article.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(EARLIEST_PUBLISH_DATE)
  publishedAt?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptionalNotNull()
  @IsBoolean()
  commentsEnabled?: boolean;
}

export class UpdateArticleDto {
  @ApiPropertyOptional({
    minLength: ARTICLE_TITLE_MIN_LENGTH,
    maxLength: ARTICLE_TITLE_MAX_LENGTH,
  })
  @IsOptionalNotNull()
  @IsSingleLineText(ARTICLE_TITLE_MIN_LENGTH, ARTICLE_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    description: 'Not changed when only the title changes (stable URLs)',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: ARTICLE_EXCERPT_MAX_LENGTH,
    description: 'An empty string derives it again from the content',
  })
  @IsOptionalNotNull()
  @IsPlainText(ARTICLE_EXCERPT_MAX_LENGTH)
  excerpt?: string;

  @ApiPropertyOptional({ maxLength: ARTICLE_CONTENT_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsRichText(ARTICLE_CONTENT_MAX_LENGTH)
  content?: string;

  @ApiPropertyOptional({
    type: CoverImageDto,
    nullable: true,
    description: 'null removes the cover image',
  })
  @IsOptional() // null is meaningful here: "remove it"
  @ValidateNested()
  @Type(() => CoverImageDto)
  coverImage?: CoverImageDto | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Category id, or null to remove it',
  })
  @IsOptional()
  @IsMongoId()
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS_PER_ARTICLE,
    description: 'Replaces all tags; [] removes them',
  })
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_ARTICLE)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ enum: ArticleStatus })
  @IsOptionalNotNull()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'null resets it (set to now again on next publication)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(EARLIEST_PUBLISH_DATE)
  publishedAt?: Date | null;

  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsBoolean()
  commentsEnabled?: boolean;
}

class ArticleSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Full-text search on title and excerpt',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;
}

// Every field is a typed scalar, so no Mongo operator can reach a filter.
export class ListArticlesQueryDto extends ArticleSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Category slug; includes its subcategories',
  })
  @IsOptional()
  @IsSlug()
  category?: string;

  @ApiPropertyOptional({ description: 'Tag slug' })
  @IsOptional()
  @IsSlug()
  tag?: string;

  @ApiPropertyOptional({ enum: PUBLIC_ARTICLE_SORTS, default: '-publishedAt' })
  @IsOptional()
  @IsIn(PUBLIC_ARTICLE_SORTS)
  sort: PublicArticleSort = '-publishedAt';
}

export class AdminListArticlesQueryDto extends ArticleSearchQueryDto {
  @ApiPropertyOptional({ enum: ArticleStatus })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({ description: 'Category id (exact, no subcategories)' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Tag id' })
  @IsOptional()
  @IsMongoId()
  tagId?: string;

  @ApiPropertyOptional({ enum: ADMIN_ARTICLE_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(ADMIN_ARTICLE_SORTS)
  sort: AdminArticleSort = '-createdAt';
}
