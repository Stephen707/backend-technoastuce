import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum ContentType {
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
}

/**
 * Views of one piece of content on one UTC day (unique visitors). Only
 * aggregates are stored: no IP, user agent or visitor id, so there is no
 * personal data here. One small document per content and day.
 */
@Schema({ collection: 'analytics_daily', versionKey: false })
export class DailyStat {
  // "YYYY-MM-DD" (UTC); sorts and compares like a date.
  @Prop({ required: true })
  day: string;

  @Prop({ type: String, enum: ContentType, required: true })
  targetType: ContentType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  target: Types.ObjectId;

  @Prop({ default: 0, min: 0 })
  views: number;
}

export type DailyStatDocument = HydratedDocument<DailyStat>;

export const DailyStatSchema = SchemaFactory.createForClass(DailyStat);

// One counter per (type, day, content); the same index serves the upsert,
// "popular over the last N days" (type + day range) and the daily totals.
DailyStatSchema.index(
  { targetType: 1, day: 1, target: 1 },
  { unique: true },
);
// Per-content history.
DailyStatSchema.index({ target: 1, day: -1 });
