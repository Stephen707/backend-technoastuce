import { Types } from 'mongoose';

// Shape of a lean document read with TAG_PROJECTION.
export interface TagRecord {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagView {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}
