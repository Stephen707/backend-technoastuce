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
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
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
import { PaginatedTagsResponse, TagResponse } from './dto/tag-responses.dto';
import { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tags.dto';
import { TagsService } from './tags.service';

// Reads are public; writes need an admin with a 2FA-verified session.
// `/slug/:slug` is declared before `/:id` so it always wins.
@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  // ----------------------------------------------------------------- public

  @Get()
  @ApiOperation({ summary: 'List tags (paginated, searchable)' })
  @ApiOkResponse({ type: PaginatedTagsResponse })
  list(@Query() query: ListTagsQueryDto) {
    return this.tags.list(query);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a tag by slug' })
  @ApiOkResponse({ type: TagResponse })
  @ApiNotFoundResponse()
  getBySlug(@Param('slug', ParseSlugPipe) slug: string) {
    return this.tags.getBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tag by id' })
  @ApiOkResponse({ type: TagResponse })
  @ApiNotFoundResponse()
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.tags.getById(id);
  }

  // ------------------------------------------------------------------ admin

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Create a tag' })
  @ApiCreatedResponse({ type: TagResponse })
  @ApiConflictResponse({ description: 'Slug or name already used' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTagDto) {
    return this.tags.create(actor, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Rename a tag or change its slug' })
  @ApiOkResponse({ type: TagResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Slug or name already used' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tags.update(actor, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete a tag' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.tags.remove(actor, id);
  }
}
