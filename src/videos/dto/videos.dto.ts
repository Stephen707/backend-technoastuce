import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinDate,
  ValidateBy,
} from 'class-validator';
import { IsSingleLineText } from '../../articles/articles.validation';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug';
import {
  IsOptionalNotNull,
  IsPlainText,
  IsSlug,
} from '../../taxonomy/taxonomy.validation';
import {
  MAX_TAGS_PER_VIDEO,
  VIDEO_DESCRIPTION_MAX_LENGTH,
  VIDEO_MAX_DURATION_SECONDS,
  VIDEO_THUMBNAIL_URL_MAX_LENGTH,
  VIDEO_TITLE_MAX_LENGTH,
  VIDEO_TITLE_MIN_LENGTH,
  VideoStatus,
} from '../schemas/video.schema';
import { parseVideoUrl, VIDEO_URL_MAX_LENGTH, VideoProvider } from '../video-url';

export const PUBLIC_VIDEO_SORTS = ['-publishedAt', 'publishedAt'] as const;
export type PublicVideoSort = (typeof PUBLIC_VIDEO_SORTS)[number];

export const ADMIN_VIDEO_SORTS = [
  '-createdAt',
  'createdAt',
  '-updatedAt',
  '-publishedAt',
  'publishedAt',
  'title',
  '-title',
] as const;
export type AdminVideoSort = (typeof ADMIN_VIDEO_SORTS)[number];

const SEARCH_MAX_LENGTH = 100;
const EARLIEST_PUBLISH_DATE = new Date('2000-01-01T00:00:00Z');

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

function IsVideoUrl(): PropertyDecorator {
  return applyDecorators(
    Transform(trim),
    IsString(),
    MaxLength(VIDEO_URL_MAX_LENGTH),
    ValidateBy({
      name: 'isVideoUrl',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && parseVideoUrl(value) !== null,
        defaultMessage: () =>
          '$property must be a YouTube or Vimeo video URL',
      },
    }),
  );
}

function IsHttpsUrl(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(VIDEO_THUMBNAIL_URL_MAX_LENGTH),
    IsUrl({
      protocols: ['https'],
      require_protocol: true,
      require_tld: true,
      disallow_auth: true,
    }),
  );
}

function IsDuration(): PropertyDecorator {
  return applyDecorators(IsInt(), Min(1), Max(VIDEO_MAX_DURATION_SECONDS));
}

// Explicit fields only (no author, provider ids, ...): the service maps
// each one by hand and derives provider/id from `url`.
export class CreateVideoDto {
  @ApiProperty({
    example: 'Installer Windows 11 sans compte Microsoft',
    minLength: VIDEO_TITLE_MIN_LENGTH,
    maxLength: VIDEO_TITLE_MAX_LENGTH,
  })
  @IsSingleLineText(VIDEO_TITLE_MIN_LENGTH, VIDEO_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description:
      'YouTube (watch, youtu.be, shorts, embed) or Vimeo link; only the video id is kept',
  })
  @IsVideoUrl()
  url: string;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    description: 'Derived from the title when omitted',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: VIDEO_DESCRIPTION_MAX_LENGTH,
    description: 'Plain text',
  })
  @IsOptionalNotNull()
  @IsPlainText(VIDEO_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Absolute https URL; defaults to the YouTube thumbnail',
  })
  @IsOptional()
  @IsHttpsUrl()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: VIDEO_MAX_DURATION_SECONDS })
  @IsOptional()
  @IsDuration()
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'Category id' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_TAGS_PER_VIDEO })
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_VIDEO)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ enum: VideoStatus, default: VideoStatus.DRAFT })
  @IsOptionalNotNull()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(EARLIEST_PUBLISH_DATE)
  publishedAt?: Date;
}

export class UpdateVideoDto {
  @ApiPropertyOptional({
    minLength: VIDEO_TITLE_MIN_LENGTH,
    maxLength: VIDEO_TITLE_MAX_LENGTH,
  })
  @IsOptionalNotNull()
  @IsSingleLineText(VIDEO_TITLE_MIN_LENGTH, VIDEO_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ description: 'Replaces the video' })
  @IsOptionalNotNull()
  @IsVideoUrl()
  url?: string;

  @ApiPropertyOptional({ maxLength: SLUG_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: VIDEO_DESCRIPTION_MAX_LENGTH,
    description: '"" clears it',
  })
  @IsOptionalNotNull()
  @IsPlainText(VIDEO_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'null goes back to the default thumbnail',
  })
  @IsOptional()
  @IsHttpsUrl()
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsDuration()
  durationSeconds?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsMongoId()
  categoryId?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_TAGS_PER_VIDEO })
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_VIDEO)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ enum: VideoStatus })
  @IsOptionalNotNull()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(EARLIEST_PUBLISH_DATE)
  publishedAt?: Date | null;
}

class VideoSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Full-text search on title and description',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;
}

export class ListVideosQueryDto extends VideoSearchQueryDto {
  @ApiPropertyOptional({ description: 'Category slug; includes subcategories' })
  @IsOptional()
  @IsSlug()
  category?: string;

  @ApiPropertyOptional({ description: 'Tag slug' })
  @IsOptional()
  @IsSlug()
  tag?: string;

  @ApiPropertyOptional({ enum: PUBLIC_VIDEO_SORTS, default: '-publishedAt' })
  @IsOptional()
  @IsIn(PUBLIC_VIDEO_SORTS)
  sort: PublicVideoSort = '-publishedAt';
}

export class AdminListVideosQueryDto extends VideoSearchQueryDto {
  @ApiPropertyOptional({ enum: VideoStatus })
  @IsOptional()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @ApiPropertyOptional({ enum: VideoProvider })
  @IsOptional()
  @IsEnum(VideoProvider)
  provider?: VideoProvider;

  @ApiPropertyOptional({ enum: ADMIN_VIDEO_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(ADMIN_VIDEO_SORTS)
  sort: AdminVideoSort = '-createdAt';
}
