import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum SubscriberStatus {
  PENDING = 'PENDING', // waiting for the double opt-in confirmation
  CONFIRMED = 'CONFIRMED',
  UNSUBSCRIBED = 'UNSUBSCRIBED',
}

export const SUBSCRIBER_SOURCE_MAX_LENGTH = 50;

/**
 * Newsletter subscriber (double opt-in). The confirmation token is stored
 * hashed and expires; the unsubscribe token is a random, low-privilege
 * secret kept in clear (it goes into every email) but never selected by
 * default.
 */
@Schema({ timestamps: true, collection: 'newsletter_subscribers' })
export class Subscriber {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({
    type: String,
    enum: SubscriberStatus,
    default: SubscriberStatus.PENDING,
  })
  status: SubscriberStatus;

  // Where the form was (e.g. "footer", "article"), for statistics.
  @Prop({ trim: true, maxlength: SUBSCRIBER_SOURCE_MAX_LENGTH })
  source?: string;

  @Prop({ select: false })
  confirmTokenHash?: string;

  @Prop({ select: false })
  confirmTokenExpiresAt?: Date;

  // Throttles confirmation emails to the same address.
  @Prop()
  confirmationSentAt?: Date;

  @Prop()
  confirmedAt?: Date;

  @Prop()
  unsubscribedAt?: Date;

  @Prop({ required: true, select: false })
  unsubscribeToken: string;

  createdAt: Date;
  updatedAt: Date;
}

export type SubscriberDocument = HydratedDocument<Subscriber>;

export const SubscriberSchema = SchemaFactory.createForClass(Subscriber);

// `email` is uniquely indexed through its @Prop. Token lookups:
SubscriberSchema.index({ unsubscribeToken: 1 }, { unique: true });
SubscriberSchema.index({ confirmTokenHash: 1 }, { sparse: true });
// Admin listing by status, newest first; campaign delivery by _id.
SubscriberSchema.index({ status: 1, createdAt: -1 });
SubscriberSchema.index({ status: 1, _id: 1 });
SubscriberSchema.index({ createdAt: -1 });
