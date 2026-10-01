import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

// Privileged accounts must pass TOTP before using role-protected routes.
export const PRIVILEGED_ROLES: readonly Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

// Higher rank = more privileges. An admin can only manage lower ranks.
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.USER]: 0,
  [Role.ADMIN]: 1,
  [Role.SUPER_ADMIN]: 2,
};

// Every secret field is `select: false`: it never leaves the DB unless a
// query explicitly asks for it with `.select('+field')`.
@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ trim: true, maxlength: 50 })
  firstName?: string;

  @Prop({ trim: true, maxlength: 50 })
  lastName?: string;

  @Prop({ type: String, enum: Role, default: Role.USER })
  role: Role;

  @Prop({ default: true })
  isActive: boolean;

  // Email verification
  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  emailVerifiedAt?: Date;

  @Prop({ select: false })
  emailVerificationTokenHash?: string;

  @Prop({ select: false })
  emailVerificationExpiresAt?: Date;

  // Password reset (single use: fields are $unset once consumed)
  @Prop({ select: false })
  passwordResetTokenHash?: string;

  @Prop({ select: false })
  passwordResetExpiresAt?: Date;

  @Prop()
  passwordChangedAt?: Date;

  // Brute-force protection
  @Prop({ default: 0, select: false })
  failedLoginAttempts: number;

  @Prop({ select: false })
  lockedUntil?: Date;

  // TOTP two-factor auth (secrets are AES-256-GCM encrypted)
  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop({ select: false })
  twoFactorSecret?: string;

  @Prop({ select: false })
  twoFactorPendingSecret?: string;

  // Last accepted TOTP time-step, so a code can't be replayed.
  @Prop({ select: false })
  twoFactorLastUsedStep?: number;

  @Prop()
  lastLoginAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

// `email` is uniquely indexed through its @Prop. Token lookups are sparse
// because the fields only exist while a token is pending.
UserSchema.index({ emailVerificationTokenHash: 1 }, { sparse: true });
UserSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });
// Admin listing: default sort, and filter by role sorted by date.
UserSchema.index({ createdAt: -1 });
UserSchema.index({ role: 1, createdAt: -1 });
