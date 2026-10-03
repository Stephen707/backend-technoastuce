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
import type { AuthUser } from '../../auth/auth.types';
import { AdminOnly } from '../../auth/decorators/admin-only.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ParseSlugPipe } from '../../common/pipes/parse-slug.pipe';
import { CategoriesService } from './categories.service';
import {
  CategoryDetailResponse,
  CategoryResponse,
  CategoryTreeNodeResponse,
  PaginatedCategoriesResponse,
} from './dto/category-responses.dto';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/categories.dto';

// Reads are public; writes need an admin with a 2FA-verified session.
// `/tree` and `/slug/:slug` are declared before `/:id` so they always win.
@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // ----------------------------------------------------------------- public

  @Get()
  @ApiOperation({ summary: 'List categories (paginated, filterable)' })
  @ApiOkResponse({ type: PaginatedCategoriesResponse })
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Get('tree')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Full category tree',
    description: 'Nested, ordered by position. Cached for up to 60 s.',
  })
  @ApiOkResponse({ type: [CategoryTreeNodeResponse] })
  tree() {
    return this.categories.getTree();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a category by slug, with its breadcrumb' })
  @ApiOkResponse({ type: CategoryDetailResponse })
  @ApiNotFoundResponse()
  getBySlug(@Param('slug', ParseSlugPipe) slug: string) {
    return this.categories.getBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category by id, with its breadcrumb' })
  @ApiOkResponse({ type: CategoryDetailResponse })
  @ApiNotFoundResponse()
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.categories.getById(id);
  }

  // ------------------------------------------------------------------ admin

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Create a category' })
  @ApiCreatedResponse({ type: CategoryResponse })
  @ApiBadRequestResponse({
    description: 'Invalid body, unknown parent, too deep',
  })
  @ApiConflictResponse({ description: 'Slug or sibling name already used' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(actor, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary: '[Admin] Update or move a category',
    description:
      'Moving (parentId) carries the whole subtree along; cycles and moves deeper than 3 levels are rejected.',
  })
  @ApiOkResponse({ type: CategoryResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Slug or sibling name already used' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(actor, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete a category without subcategories' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The category has subcategories' })
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.categories.remove(actor, id);
  }
}
