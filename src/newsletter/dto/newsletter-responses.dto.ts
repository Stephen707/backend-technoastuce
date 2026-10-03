import { ApiProperty } from '@nestjs/swagger';
import { CampaignStatus } from '../schemas/campaign.schema';
import { SubscriberStatus } from '../schemas/subscriber.schema';

// Swagger-only response shapes.

export class NewsletterMessageResponse {
  @ApiProperty() message: string;
}

export class SubscriberResponse {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: SubscriberStatus }) status: SubscriberStatus;
  @ApiProperty({ type: String, nullable: true }) source: string | null;
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) unsubscribedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaginatedSubscribersResponse {
  @ApiProperty({ type: [SubscriberResponse] }) items: SubscriberResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class SubscriberStatsResponse {
  @ApiProperty() PENDING: number;
  @ApiProperty() CONFIRMED: number;
  @ApiProperty() UNSUBSCRIBED: number;
  @ApiProperty() total: number;
}

export class CampaignSummaryResponse {
  @ApiProperty() id: string;
  @ApiProperty() subject: string;
  @ApiProperty({ enum: CampaignStatus }) status: CampaignStatus;
  @ApiProperty() recipientCount: number;
  @ApiProperty() sentCount: number;
  @ApiProperty() failedCount: number;
  @ApiProperty({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) finishedAt: Date | null;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CampaignResponse extends CampaignSummaryResponse {
  @ApiProperty({ description: 'Sanitized HTML' }) content: string;
}

export class PaginatedCampaignsResponse {
  @ApiProperty({ type: [CampaignSummaryResponse] })
  items: CampaignSummaryResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
