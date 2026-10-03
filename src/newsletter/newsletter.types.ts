import { Types } from 'mongoose';
import { CampaignStatus } from './schemas/campaign.schema';
import { SubscriberStatus } from './schemas/subscriber.schema';

export interface SubscriberRecord {
  _id: Types.ObjectId;
  email: string;
  status: SubscriberStatus;
  source?: string;
  confirmedAt?: Date;
  unsubscribedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Admin view (subscribers never see each other).
export interface SubscriberView {
  id: string;
  email: string;
  status: SubscriberStatus;
  source: string | null;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriberStats = Record<SubscriberStatus, number> & {
  total: number;
};

export interface CampaignRecord {
  _id: Types.ObjectId;
  subject: string;
  content?: string;
  status: CampaignStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignSummaryView {
  id: string;
  subject: string;
  status: CampaignStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignView extends CampaignSummaryView {
  content: string;
}
