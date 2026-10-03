import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Article } from '../../articles/schemas/article.schema';
import { User } from '../../users/schemas/user.schema';

export enum CommentStatus {
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
}

export const COMMENT_MAX_LENGTH = 2000;
// Authors can fix a typo for this long; after that the text is final, so a
// harmless comment can't be turned into spam once it has been read.
export const COMMENT_EDIT_WINDOW_MS = 15 * 60_000;

/**
 * A plain-text comment on an article. Threads are one level deep: `parent`
 * is null for a top-level comment, or the top-level comment it answers.
 * `replyCount` counts PUBLISHED replies (kept by CommentsService).
 */
@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Article.name,
    required: true,
  })
  article: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  author: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Comment', default: null })
  parent: Types.ObjectId | null;

  @Prop({ required: true, maxlength: COMMENT_MAX_LENGTH })
  content: string;

  @Prop({ type: String, enum: CommentStatus, default: CommentStatus.PUBLISHED })
  status: CommentStatus;

  @Prop({ default: 0, min: 0 })
  replyCount: number;

  @Prop({ type: Date, default: null })
  editedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

export const CommentSchema = SchemaFactory.createForClass(Comment);

// Top-level comments of an article (parent: null), both sort directions;
// also serves the cascade delete by article.
CommentSchema.index({
  article: 1,
  parent: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});
// Replies of a comment, oldest first.
CommentSchema.index({ parent: 1, status: 1, createdAt: 1, _id: 1 });
// Moderation queue.
CommentSchema.index({ status: 1, createdAt: -1 });
