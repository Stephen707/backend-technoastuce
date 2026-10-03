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
import {
  PaginatedVideosResponse,
  VideoResponse,
} from './dto/video-responses.dto';
import {
  AdminListVideosQueryDto,
  CreateVideoDto,
  ListVideosQueryDto,
  UpdateVideoDto,
} from './dto/videos.dto';
import { VideosService } from './videos.service';

// Same layout as ArticlesController: public reads of published videos,
// `/admin` reads and every write need an admin with a 2FA-verified session.
@ApiTags('Videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  // ----------------------------------------------------------------- public

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'List published videos (paginated)' })
  @ApiOkResponse({ type: PaginatedVideosResponse })
  list(@Query() query: ListVideosQueryDto) {
    return this.videos.listPublished(query);
  }

  @Get('slug/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Get a published video by slug' })
  @ApiOkResponse({ type: VideoResponse })
  @ApiNotFoundResponse()
  getBySlug(@Param('slug', ParseSlugPipe) slug: string) {
    return this.videos.getPublishedBySlug(slug);
  }

  // ------------------------------------------------------------------ admin

  @Get('admin')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] List all videos, any status' })
  @ApiOkResponse({ type: PaginatedVideosResponse })
  listAll(@Query() query: AdminListVideosQueryDto) {
    return this.videos.listAll(query);
  }

  @Get('admin/:id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Get any video by id' })
  @ApiOkResponse({ type: VideoResponse })
  @ApiNotFoundResponse()
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.videos.getById(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Add a YouTube or Vimeo video' })
  @ApiCreatedResponse({ type: VideoResponse })
  @ApiBadRequestResponse({ description: 'Invalid body, unknown category/tag' })
  @ApiConflictResponse({ description: 'Slug or video already used' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateVideoDto) {
    return this.videos.create(actor, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Update a video' })
  @ApiOkResponse({ type: VideoResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Slug or video already used' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videos.update(actor, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete a video' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.videos.remove(actor, id);
  }
}
