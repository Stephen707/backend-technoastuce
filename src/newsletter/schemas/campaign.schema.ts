import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export const CAMPAIGN_SUBJECT_MIN_LENGTH = 3;
export const CAMPAIGN_SUBJECT_MAX_LENGTH = 150;
export const CAMPAIGN_CONTENT_MAX_LENGTH = 100_000;

/**
 * A newsletter issue. Only a DRAFT can be edited, deleted or sent; sending
 * moves it atomically to SENDING (so it can't go out twice), then to SENT
 * (or FAILED) once every confirmed subscriber was processed.
 */
@Schema({ timestamps: true, collection: 'newsletter_campaigns' })
export class Campaign {
  @Prop({ required: true, trim: true, maxlength: CAMPAIGN_SUBJECT_MAX_LENGTH })
  subject: string;

  // Sanitized rich-text HTML.
  @Prop({ required: true, maxlength: CAMPAIGN_CONTENT_MAX_LENGTH })
  content: string;

  @Prop({ type: String, enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Prop({ default: 0, min: 0 })
  recipientCount: number;

  @Prop({ default: 0, min: 0 })
  sentCount: number;

  @Prop({ default: 0, min: 0 })
  failedCount: number;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type CampaignDocument = HydratedDocument<Campaign>;

export const CampaignSchema = SchemaFactory.createForClass(Campaign);

CampaignSchema.index({ createdAt: -1 });
CampaignSchema.index({ status: 1, createdAt: -1 });
