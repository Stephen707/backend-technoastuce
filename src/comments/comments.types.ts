import { Types } from 'mongoose';
import { AuthorRecord, AuthorView } from '../users/author-view';
import { CommentStatus } from './schemas/comment.schema';

// Lean document read with COMMENT_PROJECTION and its author populated.
export interface CommentRecord {
  _id: Types.ObjectId;
  article: Types.ObjectId;
  parent: Types.ObjectId | null;
  author: AuthorRecord | null;
  content: string;
  status: CommentStatus;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentView {
  id: string;
  articleId: string;
  parentId: string | null;
  author: AuthorView | null;
  content: string;
  status: CommentStatus;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
}

export interface CommentListFilters {
  status?: CommentStatus;
  article?: Types.ObjectId;
}
