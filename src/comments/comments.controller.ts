import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { AdminOnly } from '../auth/decorators/admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import {
  CommentResponse,
  PaginatedCommentsResponse,
} from './dto/comment-responses.dto';
import {
  AdminListCommentsQueryDto,
  CreateCommentDto,
  ListCommentsQueryDto,
  ListRepliesQueryDto,
  ModerateCommentDto,
  UpdateCommentDto,
} from './dto/comments.dto';

// Anti-spam: posting is limited per IP on top of the global limit.
const POST_LIMIT = { default: { limit: 5, ttl: 60_000 } };

// Comments as a sub-resource of a published article.
@ApiTags('Comments')
@Controller('articles/:articleId/comments')
export class ArticleCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOperation({ summary: 'List top-level comments of a published article' })
  @ApiOkResponse({ type: PaginatedCommentsResponse })
  @ApiNotFoundResponse({ description: 'Article not found or not published' })
  list(
    @Param('articleId', ParseObjectIdPipe) articleId: Types.ObjectId,
    @Query() query: ListCommentsQueryDto,
  ) {
    return this.comments.listForArticle(articleId, query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle(POST_LIMIT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Comment on an article, or reply to a comment' })
  @ApiCreatedResponse({ type: CommentResponse })
  @ApiBadRequestResponse({ description: 'Invalid body or parent comment' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse({ description: 'Comments are closed' })
  @ApiNotFoundResponse({ description: 'Article not found or not published' })
  @ApiTooManyRequestsResponse()
  create(
    @CurrentUser() actor: AuthUser,
    @Param('articleId', ParseObjectIdPipe) articleId: Types.ObjectId,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(actor, articleId, dto);
  }
}

// `GET /comments` is the moderation queue; static segments come before
// `/:id`.
@ApiTags('Comments')
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] List comments for moderation' })
  @ApiOkResponse({ type: PaginatedCommentsResponse })
  listAll(@Query() query: AdminListCommentsQueryDto) {
    return this.comments.listAll(query);
  }

  @Get(':id/replies')
  @ApiOperation({ summary: 'List the replies of a comment (oldest first)' })
  @ApiOkResponse({ type: PaginatedCommentsResponse })
  @ApiNotFoundResponse()
  replies(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: ListRepliesQueryDto,
  ) {
    return this.comments.listReplies(id, query);
  }

  @Patch(':id/status')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Hide or re-publish a comment' })
  @ApiOkResponse({ type: CommentResponse })
  @ApiNotFoundResponse()
  moderate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ModerateCommentDto,
  ) {
    return this.comments.moderate(actor, id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Throttle(POST_LIMIT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Edit your own comment (within 15 minutes of posting)',
  })
  @ApiOkResponse({ type: CommentResponse })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse({ description: 'Not the author, or too late' })
  @ApiNotFoundResponse()
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(actor, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete a comment (its author, or an admin with 2FA)',
    description: 'Deleting a top-level comment also deletes its replies.',
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.comments.remove(actor, id);
  }
}
