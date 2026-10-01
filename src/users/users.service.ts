import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Model, SortOrder, Types, UpdateQuery } from 'mongoose';
import { escapeRegex } from '../common/utils/regex';
import { Role, User, UserDocument } from './schemas/user.schema';
import { AdminUserRecord, AdminUserView, UserListFilters } from './users.types';

// Only the fields an admin view needs (lockedUntil is `select: false`, but an
// explicit inclusion selects it).
const ADMIN_VIEW_PROJECTION =
  'email firstName lastName role isActive emailVerified twoFactorEnabled lockedUntil lastLoginAt createdAt updatedAt';

// Every filter value is typed by the caller (strings, enum, boolean) and the
// search term is escaped, so no operator can be injected from user input.
export function buildUserListFilter(
  filters: UserListFilters,
): QueryFilter<User> {
  const filter: QueryFilter<User> = {};
  if (filters.role) filter.role = filters.role;
  if (filters.isActive !== undefined) filter.isActive = filters.isActive;
  if (filters.search) {
    const term = escapeRegex(filters.search);
    filter.$or = [
      // Emails are stored lowercase: a case-sensitive prefix can use the index.
      { email: { $regex: `^${escapeRegex(filters.search.toLowerCase())}` } },
      { firstName: { $regex: `^${term}`, $options: 'i' } },
      { lastName: { $regex: `^${term}`, $options: 'i' } },
    ];
  }
  return filter;
}

// "-createdAt" -> { createdAt: -1, _id: -1 }; _id keeps paging stable.
export function parseUserSort(sort: string): Record<string, SortOrder> {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const order: SortOrder = desc ? -1 : 1;
  return { [field]: order, _id: order };
}

export interface PublicUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: User['role'];
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  create(data: Partial<User>): Promise<UserDocument> {
    return this.userModel.create(data);
  }

  findById(id: string | Types.ObjectId, select?: string) {
    return this.userModel
      .findById(id)
      .select(select ?? '')
      .exec();
  }

  findByEmail(email: string, select?: string) {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select(select ?? '')
      .exec();
  }

  updateById(id: string | Types.ObjectId, update: UpdateQuery<User>) {
    return this.userModel.updateOne({ _id: id }, update).exec();
  }

  // Atomically claims a pending token: only one request can match it, which
  // makes reset/verification tokens strictly single use.
  consumeToken(
    field: 'passwordResetTokenHash' | 'emailVerificationTokenHash',
    expiresField: 'passwordResetExpiresAt' | 'emailVerificationExpiresAt',
    tokenHash: string,
    update: UpdateQuery<User>,
  ) {
    return this.userModel
      .findOneAndUpdate(
        { [field]: tokenHash, [expiresField]: { $gt: new Date() } },
        { ...update, $unset: { [field]: 1, [expiresField]: 1 } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  // Records a used TOTP time-step only if it's newer than the last one, so
  // two concurrent requests can't both spend the same code.
  async claimTotpStep(id: Types.ObjectId, step: number): Promise<boolean> {
    const res = await this.userModel
      .updateOne(
        {
          _id: id,
          $or: [
            { twoFactorLastUsedStep: { $exists: false } },
            { twoFactorLastUsedStep: { $lt: step } },
          ],
        },
        { $set: { twoFactorLastUsedStep: step } },
      )
      .exec();
    return res.modifiedCount > 0;
  }

  // One page of users + total count, run in parallel. Lean + projection: no
  // hydration cost and no secret fields read from the DB.
  async list(
    filters: UserListFilters,
    page: number,
    limit: number,
    sort: string,
  ): Promise<{ items: AdminUserRecord[]; total: number }> {
    const filter = buildUserListFilter(filters);
    const hasFilter = Object.keys(filter).length > 0;
    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select(ADMIN_VIEW_PROJECTION)
        .sort(parseUserSort(sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AdminUserRecord[]>()
        .exec(),
      hasFilter
        ? this.userModel.countDocuments(filter).exec()
        : this.userModel.estimatedDocumentCount().exec(),
    ]);
    return { items, total };
  }

  findAdminRecord(id: Types.ObjectId): Promise<AdminUserRecord | null> {
    return this.userModel
      .findById(id)
      .select(ADMIN_VIEW_PROJECTION)
      .lean<AdminUserRecord>()
      .exec();
  }

  // Applies the update only if the user still has `expectedRole`, so a
  // permission check made on a stale read can't be bypassed by a race.
  updateIfRole(
    id: Types.ObjectId,
    expectedRole: Role,
    update: UpdateQuery<User>,
  ): Promise<AdminUserRecord | null> {
    return this.userModel
      .findOneAndUpdate({ _id: id, role: expectedRole }, update, {
        returnDocument: 'after',
        runValidators: true,
      })
      .select(ADMIN_VIEW_PROJECTION)
      .lean<AdminUserRecord>()
      .exec();
  }

  toAdminView(user: AdminUserRecord, now = new Date()): AdminUserView {
    const locked = !!user.lockedUntil && user.lockedUntil > now;
    return {
      id: user._id.toHexString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      locked,
      lockedUntil: locked ? user.lockedUntil : undefined,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // Explicit allowlist: secrets can never leak through a response.
  toPublic(user: UserDocument): PublicUser {
    return {
      id: user.id as string,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    };
  }
}
