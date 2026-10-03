import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SLUG_MAX_LENGTH } from '../../../common/utils/slug';
import { TaxonomyListQueryDto } from '../../dto/taxonomy-query.dto';
import {
  CATEGORY_NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  IsOptionalNotNull,
  IsPlainText,
  IsSlug,
  IsTaxonomyName,
} from '../../taxonomy.validation';
import { MAX_CATEGORY_POSITION } from '../schemas/category.schema';

export const CATEGORY_SORTS = [
  'position',
  'name',
  '-name',
  'createdAt',
  '-createdAt',
] as const;
export type CategorySort = (typeof CATEGORY_SORTS)[number];

export const ROOT_PARENT = 'root';

// Explicit fields only: anything else (ancestors, _id, createdAt, ...) is
// rejected by the global whitelist pipe, and the service maps each field
// into the update by hand.
export class CreateCategoryDto {
  @ApiProperty({ example: 'Windows', maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsTaxonomyName(CATEGORY_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    example: 'windows',
    maxLength: SLUG_MAX_LENGTH,
    description: 'Derived from the name when omitted',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsPlainText(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ description: 'Parent category id (omit for a root)' })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: MAX_CATEGORY_POSITION,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(MAX_CATEGORY_POSITION)
  position?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsTaxonomyName(CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    description: 'Not changed when only the name changes (stable URLs)',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: DESCRIPTION_MAX_LENGTH,
    description: 'An empty string removes the description',
  })
  @IsOptionalNotNull()
  @IsPlainText(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'New parent id, or null to make it a root category',
  })
  @IsOptional() // null is meaningful here: "move to the root"
  @IsMongoId()
  parentId?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CATEGORY_POSITION })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(MAX_CATEGORY_POSITION)
  position?: number;
}

export class ListCategoriesQueryDto extends TaxonomyListQueryDto {
  @ApiPropertyOptional({
    description: `Only the direct children of this category id, or "${ROOT_PARENT}" for top-level categories`,
  })
  @IsOptional()
  @Matches(/^(root|[a-f\d]{24})$/i, {
    message: `parent must be a category id or "${ROOT_PARENT}"`,
  })
  parent?: string;

  @ApiPropertyOptional({ enum: CATEGORY_SORTS, default: 'position' })
  @IsOptional()
  @IsIn(CATEGORY_SORTS)
  sort: CategorySort = 'position';
}
