import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SLUG_MAX_LENGTH } from '../../../common/utils/slug';
import { NAME_COLLATION } from '../../categories/schemas/category.schema';
import { TAG_NAME_MAX_LENGTH } from '../../taxonomy.validation';

@Schema({ timestamps: true, collection: 'tags' })
export class Tag {
  @Prop({ required: true, trim: true, maxlength: TAG_NAME_MAX_LENGTH })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: SLUG_MAX_LENGTH,
  })
  slug: string;

  createdAt: Date;
  updatedAt: Date;
}

export type TagDocument = HydratedDocument<Tag>;

export const TagSchema = SchemaFactory.createForClass(Tag);

// `slug` is uniquely indexed through its @Prop. Names are unique
// case-insensitively, so "Linux" and "linux" can't both exist.
TagSchema.index({ name: 1 }, { unique: true, collation: NAME_COLLATION });
TagSchema.index({ createdAt: -1 });
