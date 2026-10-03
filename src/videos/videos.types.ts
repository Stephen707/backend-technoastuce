import { Types } from 'mongoose';
import { TaxonomyRef, TaxonomyRefRecord } from '../articles/articles.types';
import { AuthorRecord, AuthorView } from '../users/author-view';
import { VideoStatus } from './schemas/video.schema';
import { VideoProvider } from './video-url';

// Lean document read with a projection and its refs populated.
export interface VideoRecord {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  description?: string;
  provider: VideoProvider;
  providerVideoId: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  author: AuthorRecord | null;
  category: TaxonomyRefRecord | null;
  tags: (TaxonomyRefRecord | null)[];
  status: VideoStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Listing item: everything but the description.
export interface VideoSummaryView {
  id: string;
  title: string;
  slug: string;
  provider: VideoProvider;
  providerVideoId: string;
  watchUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  author: AuthorView | null;
  category: TaxonomyRef | null;
  tags: TaxonomyRef[];
  status: VideoStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoView extends VideoSummaryView {
  description: string;
}
