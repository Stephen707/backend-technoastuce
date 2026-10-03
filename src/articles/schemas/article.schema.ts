import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug';
import { Category } from '../../taxonomy/categories/schemas/category.schema';
import { Tag } from '../../taxonomy/tags/schemas/tag.schema';
import { User } from '../../users/schemas/user.schema';

export enum ArticleStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export const ARTICLE_TITLE_MIN_LENGTH = 3;
export const ARTICLE_TITLE_MAX_LENGTH = 150;
export const ARTICLE_EXCERPT_MAX_LENGTH = 300;
// Sanitized HTML. The JSON body limit (main.ts) is sized to fit it.
export const ARTICLE_CONTENT_MAX_LENGTH = 150_000;
export const MAX_TAGS_PER_ARTICLE = 10;
export const COVER_URL_MAX_LENGTH = 2048;
export const COVER_ALT_MAX_LENGTH = 150;

@Schema({ _id: false })
export class CoverImage {
  @Prop({ required: true, trim: true, maxlength: COVER_URL_MAX_LENGTH })
  url: string;

  @Prop({ trim: true, maxlength: COVER_ALT_MAX_LENGTH })
  alt?: string;
}

const CoverImageSchema = SchemaFactory.createForClass(CoverImage);

/**
 * A blog article. `content` is HTML already sanitized on input; `excerpt`
 * and `readingTimeMinutes` are derived from it when not given. An article is
 * public once `status` is PUBLISHED and `publishedAt` has passed (a future
 * date schedules it). `commentCount` counts PUBLISHED comments and is kept
 * up to date by CommentsService.
 */
@Schema({ timestamps: true, collection: 'articles' })
export class Article {
  @Prop({ required: true, trim: true, maxlength: ARTICLE_TITLE_MAX_LENGTH })
  title: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: SLUG_MAX_LENGTH,
  })
  slug: string;

  @Prop({ required: true, trim: true, maxlength: ARTICLE_EXCERPT_MAX_LENGTH })
  excerpt: string;

  @Prop({ required: true, maxlength: ARTICLE_CONTENT_MAX_LENGTH })
  content: string;

  @Prop({ type: CoverImageSchema, default: null })
  coverImage: CoverImage | null;

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

  @Prop({ type: String, enum: ArticleStatus, default: ArticleStatus.DRAFT })
  status: ArticleStatus;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ default: 1, min: 1 })
  readingTimeMinutes: number;

  @Prop({ default: true })
  commentsEnabled: boolean;

  @Prop({ default: 0, min: 0 })
  commentCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export type ArticleDocument = HydratedDocument<Article>;

export const ArticleSchema = SchemaFactory.createForClass(Article);

// `slug` is uniquely indexed through its @Prop.
// Public listings: latest published, optionally by category or tag.
ArticleSchema.index({ status: 1, publishedAt: -1, _id: -1 });
ArticleSchema.index({ category: 1, status: 1, publishedAt: -1 });
ArticleSchema.index({ tags: 1, status: 1, publishedAt: -1 });
// Admin listing.
ArticleSchema.index({ createdAt: -1 });
// Full-text search (French stemming), title weighted above the excerpt.
ArticleSchema.index(
  { title: 'text', excerpt: 'text' },
  {
    name: 'article_text',
    weights: { title: 5, excerpt: 1 },
    default_language: 'french',
  },
);
