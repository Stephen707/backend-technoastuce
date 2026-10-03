import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SLUG_MAX_LENGTH } from '../../../common/utils/slug';
import {
  CATEGORY_NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from '../../taxonomy.validation';

// Root = level 1. "Windows > Astuces > Registre" is the deepest allowed.
export const MAX_CATEGORY_DEPTH = 3;
export const MAX_CATEGORY_POSITION = 10_000;

// Case-insensitive (but accent-sensitive) comparison for name uniqueness.
export const NAME_COLLATION = { locale: 'en', strength: 2 } as const;

/**
 * Categories form a tree. `ancestors` is the materialized path from the
 * root down to the direct parent (`parent` is its last element), so
 * breadcrumbs, depth checks, cycle checks and "whole subtree" queries are
 * single indexed reads instead of a walk up the tree.
 */
@Schema({ timestamps: true, collection: 'categories' })
export class Category {
  @Prop({ required: true, trim: true, maxlength: CATEGORY_NAME_MAX_LENGTH })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: SLUG_MAX_LENGTH,
  })
  slug: string;

  @Prop({ trim: true, maxlength: DESCRIPTION_MAX_LENGTH })
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category', default: null })
  parent: Types.ObjectId | null;

  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  ancestors: Types.ObjectId[];

  // Manual ordering among siblings (ascending).
  @Prop({ default: 0, min: 0, max: MAX_CATEGORY_POSITION })
  position: number;

  createdAt: Date;
  updatedAt: Date;
}

export type CategoryDocument = HydratedDocument<Category>;

export const CategorySchema = SchemaFactory.createForClass(Category);

// `slug` is uniquely indexed through its @Prop.
// Siblings can't share a name ("Windows" vs "windows"); cousins can.
CategorySchema.index(
  { parent: 1, name: 1 },
  { unique: true, collation: NAME_COLLATION },
);
// Children of a parent in display order (tree, listing by parent).
CategorySchema.index({ parent: 1, position: 1, _id: 1 });
// Whole-subtree lookups (move, "has descendants").
CategorySchema.index({ ancestors: 1 });
CategorySchema.index({ createdAt: -1 });
