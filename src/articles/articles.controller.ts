import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { AdminOnly } from '../auth/decorators/admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseSlugPipe } from '../common/pipes/parse-slug.pipe';
import { ArticlesService } from './articles.service';
import {
  ArticleResponse,
  PaginatedArticlesResponse,
} from './dto/article-responses.dto';
import {
  AdminListArticlesQueryDto,
  CreateArticleDto,
  ListArticlesQueryDto,
  UpdateArticleDto,
} from './dto/articles.dto';

// Public reads only see published articles and may be cached briefly by
// browsers/CDNs. Everything under `/admin` and every write needs an admin
// with a 2FA-verified session. Static segments are declared before `/:id`.
@ApiTags('Articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  // ----------------------------------------------------------------- public

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'List published articles (paginated, without content)',
  })
  @ApiOkResponse({ type: PaginatedArticlesResponse })
  list(@Query() query: ListArticlesQueryDto) {
    return this.articles.listPublished(query);
  }

  @Get('slug/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Get a published article by slug' })
  @ApiOkResponse({ type: ArticleResponse })
  @ApiNotFoundResponse()
  getBySlug(@Param('slug', ParseSlugPipe) slug: string) {
    return this.articles.getPublishedBySlug(slug);
  }

  // ------------------------------------------------------------------ admin

  @Get('admin')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] List all articles, any status' })
  @ApiOkResponse({ type: PaginatedArticlesResponse })
  listAll(@Query() query: AdminListArticlesQueryDto) {
    return this.articles.listAll(query);
  }

  @Get('admin/:id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Get any article by id (drafts included)' })
  @ApiOkResponse({ type: ArticleResponse })
  @ApiNotFoundResponse()
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.articles.getById(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Create an article' })
  @ApiCreatedResponse({ type: ArticleResponse })
  @ApiBadRequestResponse({ description: 'Invalid body, unknown category/tag' })
  @ApiConflictResponse({ description: 'Slug already used' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateArticleDto) {
    return this.articles.create(actor, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary: '[Admin] Update an article',
    description:
      'Publishing (status PUBLISHED) sets publishedAt to now unless a date is given; a future date schedules it.',
  })
  @ApiOkResponse({ type: ArticleResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Slug already used' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articles.update(actor, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete an article and its comments' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.articles.remove(actor, id);
  }
}
