import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug';
import { Category } from '../../taxonomy/categories/schemas/category.schema';
import { Tag } from '../../taxonomy/tags/schemas/tag.schema';
import { User } from '../../users/schemas/user.schema';
import { VideoProvider } from '../video-url';

export enum VideoStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export const VIDEO_TITLE_MIN_LENGTH = 3;
export const VIDEO_TITLE_MAX_LENGTH = 150;
export const VIDEO_DESCRIPTION_MAX_LENGTH = 5000;
export const VIDEO_THUMBNAIL_URL_MAX_LENGTH = 2048;
export const VIDEO_MAX_DURATION_SECONDS = 24 * 3600;
export const MAX_TAGS_PER_VIDEO = 10;

/**
 * A video hosted on YouTube or Vimeo. Only the provider and the validated
 * video id are stored; embed/watch URLs are derived from them. Publication
 * rules match articles: public once PUBLISHED and `publishedAt` has passed.
 */
@Schema({ timestamps: true, collection: 'videos' })
export class Video {
  @Prop({ required: true, trim: true, maxlength: VIDEO_TITLE_MAX_LENGTH })
  title: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: SLUG_MAX_LENGTH,
  })
  slug: string;

  @Prop({ trim: true, maxlength: VIDEO_DESCRIPTION_MAX_LENGTH, default: '' })
  description: string;

  @Prop({ type: String, enum: VideoProvider, required: true })
  provider: VideoProvider;

  @Prop({ required: true })
  providerVideoId: string;

  // Custom https thumbnail; null uses the provider's default.
  @Prop({ type: String, default: null, maxlength: VIDEO_THUMBNAIL_URL_MAX_LENGTH })
  thumbnailUrl: string | null;

  @Prop({ type: Number, default: null, min: 1 })
  durationSeconds: number | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  author: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Category.name,
    default: null,
  })
  category: Types.ObjectId | null;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: Tag.name }],
    default: [],
  })
  tags: Types.ObjectId[];

  @Prop({ type: String, enum: VideoStatus, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type VideoDocument = HydratedDocument<Video>;

export const VideoSchema = SchemaFactory.createForClass(Video);

// `slug` is uniquely indexed through its @Prop. One record per video.
VideoSchema.index({ provider: 1, providerVideoId: 1 }, { unique: true });
// Public listings: latest published, optionally by category or tag.
VideoSchema.index({ status: 1, publishedAt: -1, _id: -1 });
VideoSchema.index({ category: 1, status: 1, publishedAt: -1 });
VideoSchema.index({ tags: 1, status: 1, publishedAt: -1 });
// Admin listing.
VideoSchema.index({ createdAt: -1 });
VideoSchema.index(
  { title: 'text', description: 'text' },
  {
    name: 'video_text',
    weights: { title: 5, description: 1 },
    default_language: 'french',
  },
);
