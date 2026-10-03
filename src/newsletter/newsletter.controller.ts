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
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { AdminOnly } from '../auth/decorators/admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CampaignsService } from './campaigns.service';
import {
  CampaignResponse,
  NewsletterMessageResponse,
  PaginatedCampaignsResponse,
  PaginatedSubscribersResponse,
  SubscriberStatsResponse,
} from './dto/newsletter-responses.dto';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  ListSubscribersQueryDto,
  NewsletterTokenDto,
  SubscribeDto,
  UpdateCampaignDto,
} from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';

// Anti-abuse limits per IP, on top of the global one.
const SUBSCRIBE_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const TOKEN_LIMIT = { default: { limit: 20, ttl: 60_000 } };

const SUBSCRIBE_MESSAGE =
  'If this address can be subscribed, a confirmation email is on its way.';

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  // ----------------------------------------------------------------- public

  @Post('subscribe')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(SUBSCRIBE_LIMIT)
  @ApiOperation({
    summary: 'Subscribe (sends a confirmation email: double opt-in)',
    description:
      'Same response whether the address is new, pending or already subscribed.',
  })
  @ApiAcceptedResponse({ type: NewsletterMessageResponse })
  @ApiBadRequestResponse()
  @ApiTooManyRequestsResponse()
  async subscribe(@Body() dto: SubscribeDto) {
    await this.newsletter.subscribe(dto);
    return { message: SUBSCRIBE_MESSAGE };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(TOKEN_LIMIT)
  @ApiOperation({ summary: 'Confirm a subscription with the emailed token' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid or expired token' })
  async confirm(@Body() dto: NewsletterTokenDto) {
    await this.newsletter.confirm(dto.token);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(TOKEN_LIMIT)
  @ApiOperation({ summary: 'Unsubscribe with the token from any newsletter' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid token' })
  async unsubscribe(@Body() dto: NewsletterTokenDto) {
    await this.newsletter.unsubscribe(dto.token);
  }

  // RFC 8058: mail clients POST here (token in the query string, form body
  // "List-Unsubscribe=One-Click", which is not read). Tokens in URLs are
  // redacted from logs.
  @Post('unsubscribe/one-click')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(TOKEN_LIMIT)
  @ApiOperation({ summary: 'One-click unsubscribe (List-Unsubscribe-Post)' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid token' })
  async unsubscribeOneClick(@Query() query: NewsletterTokenDto) {
    await this.newsletter.unsubscribe(query.token);
  }

  // ------------------------------------------------------------------ admin

  @Get('subscribers')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] List subscribers' })
  @ApiOkResponse({ type: PaginatedSubscribersResponse })
  list(@Query() query: ListSubscribersQueryDto) {
    return this.newsletter.list(query);
  }

  @Get('subscribers/stats')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Subscriber counts by status' })
  @ApiOkResponse({ type: SubscriberStatsResponse })
  stats() {
    return this.newsletter.stats();
  }

  @Delete('subscribers/:id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Erase a subscriber (GDPR)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.newsletter.remove(actor, id);
  }
}

@ApiTags('Newsletter')
@Controller('newsletter/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] List campaigns' })
  @ApiOkResponse({ type: PaginatedCampaignsResponse })
  list(@Query() query: ListCampaignsQueryDto) {
    return this.campaigns.list(query);
  }

  @Get(':id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Get a campaign (with delivery progress)' })
  @ApiOkResponse({ type: CampaignResponse })
  @ApiNotFoundResponse()
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.campaigns.getById(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Create a draft campaign' })
  @ApiCreatedResponse({ type: CampaignResponse })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(actor, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: '[Admin] Edit a draft campaign' })
  @ApiOkResponse({ type: CampaignResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Not a draft anymore' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(actor, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete a draft campaign' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Not a draft anymore' })
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    await this.campaigns.remove(actor, id);
  }

  @Post(':id/send')
  @AdminOnly()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '[Admin] Send a draft to every confirmed subscriber',
    description:
      'Returns at once with status SENDING; poll GET /newsletter/campaigns/:id for progress.',
  })
  @ApiAcceptedResponse({ type: CampaignResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Already sent or sending' })
  send(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    return this.campaigns.send(actor, id);
  }
}
