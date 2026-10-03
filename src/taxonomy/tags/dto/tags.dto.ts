import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { SLUG_MAX_LENGTH } from '../../../common/utils/slug';
import { TaxonomyListQueryDto } from '../../dto/taxonomy-query.dto';
import {
  IsOptionalNotNull,
  IsSlug,
  IsTaxonomyName,
  TAG_NAME_MAX_LENGTH,
} from '../../taxonomy.validation';

export const TAG_SORTS = ['name', '-name', 'createdAt', '-createdAt'] as const;
export type TagSort = (typeof TAG_SORTS)[number];

export class CreateTagDto {
  @ApiProperty({ example: 'PowerShell', maxLength: TAG_NAME_MAX_LENGTH })
  @IsTaxonomyName(TAG_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    example: 'powershell',
    maxLength: SLUG_MAX_LENGTH,
    description: 'Derived from the name when omitted',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;
}

export class UpdateTagDto {
  @ApiPropertyOptional({ maxLength: TAG_NAME_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsTaxonomyName(TAG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    description: 'Not changed when only the name changes (stable URLs)',
  })
  @IsOptionalNotNull()
  @IsSlug()
  slug?: string;
}

export class ListTagsQueryDto extends TaxonomyListQueryDto {
  @ApiPropertyOptional({ enum: TAG_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(TAG_SORTS)
  sort: TagSort = 'name';
}
