import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

// One document per logged-in device. The refresh token is only stored as a
// SHA-256 hash and is rotated on every refresh.
@Schema({ timestamps: true, collection: 'auth_sessions' })
export class AuthSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, select: false })
  refreshTokenHash: string;

  // True when this session passed a TOTP check (login or 2FA enable).
  @Prop({ default: false })
  mfaVerified: boolean;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: () => new Date() })
  lastUsedAt: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokedReason?: string;

  @Prop()
  ip?: string;

  @Prop({ maxlength: 512 })
  userAgent?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type AuthSessionDocument = HydratedDocument<AuthSession>;

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);

// "Active sessions of a user" (list, logout-all).
AuthSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });
// TTL: MongoDB deletes sessions automatically once they expire.
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
