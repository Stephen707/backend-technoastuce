import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { ClientInfo } from '../auth/auth.types';
import { AdminOnly } from '../auth/decorators/admin-only.decorator';
import { Client } from '../auth/decorators/current-user.decorator';
import { ArticleSummaryResponse } from '../articles/dto/article-responses.dto';
import { VideoSummaryResponse } from '../videos/dto/video-responses.dto';
import { AnalyticsService } from './analytics.service';
import {
  OverviewResponse,
  PopularResponse,
} from './dto/analytics-responses.dto';
import {
  OverviewQueryDto,
  PopularQueryDto,
  TrackViewDto,
} from './dto/analytics.dto';

const TRACK_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('Analytics')
@ApiExtraModels(ArticleSummaryResponse, VideoSummaryResponse)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('views')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(TRACK_LIMIT)
  @ApiOperation({
    summary: 'Record a view of a published article or video',
    description:
      'Cookieless: each visitor counts once per content and UTC day; bots are ignored.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Content not found or not public' })
  @ApiTooManyRequestsResponse()
  async track(@Body() dto: TrackViewDto, @Client() client: ClientInfo) {
    await this.analytics.trackView(dto, client);
  }

  @Get('popular')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Most viewed published content over N days' })
  @ApiOkResponse({ type: PopularResponse })
  popular(@Query() query: PopularQueryDto) {
    return this.analytics.popular(query);
  }

  @Get('overview')
  @AdminOnly()
  @ApiOperation({
    summary: '[Admin] Dashboard: daily views, top content, content and newsletter counts',
  })
  @ApiOkResponse({ type: OverviewResponse })
  @ApiBadRequestResponse({ description: 'Invalid or too long date range' })
  overview(@Query() query: OverviewQueryDto) {
    return this.analytics.overview(query);
  }
}
