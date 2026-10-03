import { ApiProperty } from '@nestjs/swagger';

// Swagger-only response shapes.

export class TagResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaginatedTagsResponse {
  @ApiProperty({ type: [TagResponse] }) items: TagResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
