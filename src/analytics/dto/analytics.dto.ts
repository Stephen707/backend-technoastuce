import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ContentType } from '../schemas/daily-stat.schema';

export const MAX_POPULAR_DAYS = 90;
export const MAX_POPULAR_LIMIT = 20;
export const MAX_OVERVIEW_DAYS = 366;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class TrackViewDto {
  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  type: ContentType;

  @ApiProperty({ description: 'Article or video id' })
  @IsMongoId()
  id: string;
}

export class PopularQueryDto {
  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  type: ContentType;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: MAX_POPULAR_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POPULAR_DAYS)
  days = 7;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: MAX_POPULAR_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POPULAR_LIMIT)
  limit = 5;
}

export class OverviewQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'First day (UTC), defaults to 29 days before `to`',
  })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: '$property must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Last day (UTC), defaults to today',
  })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: '$property must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  to?: string;
}
