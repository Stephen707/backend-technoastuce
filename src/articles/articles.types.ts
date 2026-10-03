import { Types } from 'mongoose';
import { AuthorRecord, AuthorView } from '../users/author-view';
import { ArticleStatus } from './schemas/article.schema';

export interface TaxonomyRefRecord {
  _id: Types.ObjectId;
  name: string;
  slug: string;
}

export interface TaxonomyRef {
  id: string;
  name: string;
  slug: string;
}

export interface CoverImageView {
  url: string;
  alt: string | null;
}

// Lean document read with a projection and its refs populated. A ref is null
// (or missing from `tags`) once the target has been deleted.
export interface ArticleRecord {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  excerpt: string;
  content?: string;
  coverImage: { url: string; alt?: string } | null;
  author: AuthorRecord | null;
  category: TaxonomyRefRecord | null;
  tags: (TaxonomyRefRecord | null)[];
  status: ArticleStatus;
  publishedAt: Date | null;
  readingTimeMinutes: number;
  commentsEnabled: boolean;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Listing item: everything but the body, to keep pages small.
export interface ArticleSummaryView {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage: CoverImageView | null;
  author: AuthorView | null;
  category: TaxonomyRef | null;
  tags: TaxonomyRef[];
  status: ArticleStatus;
  publishedAt: Date | null;
  readingTimeMinutes: number;
  commentsEnabled: boolean;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleView extends ArticleSummaryView {
  content: string;
}

// What CommentsService needs to know about the article being commented.
export interface CommentTarget {
  _id: Types.ObjectId;
  commentsEnabled: boolean;
}
