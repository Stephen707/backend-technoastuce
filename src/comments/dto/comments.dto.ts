import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  Max,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsPlainText } from '../../taxonomy/taxonomy.validation';
import { COMMENT_MAX_LENGTH, CommentStatus } from '../schemas/comment.schema';

export const COMMENT_SORTS = ['-createdAt', 'createdAt'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

const MAX_COMMENT_PAGE_SIZE = 50;

// Plain text only (no markup to sanitize); clients escape it when rendering.
export class CreateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: COMMENT_MAX_LENGTH })
  @IsPlainText(COMMENT_MAX_LENGTH)
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({
    description: 'Top-level comment this one replies to',
  })
  @IsOptional()
  @IsMongoId()
  parentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: COMMENT_MAX_LENGTH })
  @IsPlainText(COMMENT_MAX_LENGTH)
  @MinLength(1)
  content: string;
}

export class ModerateCommentDto {
  @ApiProperty({ enum: CommentStatus })
  @IsEnum(CommentStatus)
  status: CommentStatus;
}

export class ListCommentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: MAX_COMMENT_PAGE_SIZE,
  })
  @Max(MAX_COMMENT_PAGE_SIZE)
  limit = 20;

  @ApiPropertyOptional({ enum: COMMENT_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(COMMENT_SORTS)
  sort: CommentSort = '-createdAt';
}

export class ListRepliesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: MAX_COMMENT_PAGE_SIZE,
  })
  @Max(MAX_COMMENT_PAGE_SIZE)
  limit = 20;
}

export class AdminListCommentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CommentStatus })
  @IsOptional()
  @IsEnum(CommentStatus)
  status?: CommentStatus;

  @ApiPropertyOptional({ description: 'Article id' })
  @IsOptional()
  @IsMongoId()
  articleId?: string;

  @ApiPropertyOptional({ enum: COMMENT_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(COMMENT_SORTS)
  sort: CommentSort = '-createdAt';
}
