import { Types } from 'mongoose';
import { Role } from './schemas/user.schema';

// What admins see. Still an allowlist: hashes, tokens and TOTP secrets are
// never part of it.
export interface AdminUserView {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserListFilters {
  search?: string;
  role?: Role;
  isActive?: boolean;
}

// Shape of a lean document read with ADMIN_VIEW_PROJECTION.
export interface AdminUserRecord {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
