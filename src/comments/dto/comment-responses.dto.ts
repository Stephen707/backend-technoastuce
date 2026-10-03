import { ApiProperty } from '@nestjs/swagger';
import { AuthorResponse } from '../../articles/dto/article-responses.dto';
import { CommentStatus } from '../schemas/comment.schema';

// Swagger-only response shapes.

export class CommentResponse {
  @ApiProperty() id: string;
  @ApiProperty() articleId: string;
  @ApiProperty({ type: String, nullable: true }) parentId: string | null;
  @ApiProperty({ type: AuthorResponse, nullable: true })
  author: AuthorResponse | null;
  @ApiProperty({ description: 'Plain text; escape it when rendering' })
  content: string;
  @ApiProperty({ enum: CommentStatus }) status: CommentStatus;
  @ApiProperty() replyCount: number;
  @ApiProperty({ type: Date, nullable: true }) editedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class PaginatedCommentsResponse {
  @ApiProperty({ type: [CommentResponse] }) items: CommentResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
