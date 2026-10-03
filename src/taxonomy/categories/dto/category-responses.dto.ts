import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger-only response shapes.

export class CategoryResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: String, nullable: true }) parentId: string | null;
  @ApiProperty({ description: '1 for a root category' }) depth: number;
  @ApiProperty() position: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CategoryCrumbResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class CategoryDetailResponse extends CategoryResponse {
  @ApiProperty({
    type: [CategoryCrumbResponse],
    description: 'Ancestors, root first (breadcrumb)',
  })
  path: CategoryCrumbResponse[];
}

export class CategoryTreeNodeResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() position: number;
  @ApiProperty({ type: () => [CategoryTreeNodeResponse] })
  children: CategoryTreeNodeResponse[];
}

export class PaginatedCategoriesResponse {
  @ApiProperty({ type: [CategoryResponse] }) items: CategoryResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
