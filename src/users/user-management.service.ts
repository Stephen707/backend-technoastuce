import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types, UpdateQuery } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { PasswordService } from '../auth/services/password.service';
import { SessionsService } from '../auth/services/sessions.service';
import { MailService } from '../mail/mail.service';
import { ROLE_RANK, Role, User } from './schemas/user.schema';
import {
  AdminUpdateUserDto,
  ChangePasswordDto,
  ListUsersQueryDto,
  UpdateProfileDto,
} from './dto/users.dto';
import { PublicUser, UsersService } from './users.service';
import { AdminUserRecord, AdminUserView, Paginated } from './users.types';

/**
 * Account management: what users do to their own account (`/users/me`) and
 * what admins do to others (`/users/:id`). Route-level guards check that the
 * caller is an admin; this service checks *which* accounts they may touch.
 */
@Injectable()
export class UserManagementService {
  // Dedicated logger name so audit lines are easy to route/grep.
  private readonly audit = new Logger('Audit');

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------ self-service

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.users.toPublic(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    // Explicit field mapping: the DTO is never spread into the update.
    const $set: Partial<Pick<User, 'firstName' | 'lastName'>> = {};
    if (dto.firstName !== undefined) $set.firstName = dto.firstName;
    if (dto.lastName !== undefined) $set.lastName = dto.lastName;
    if (Object.keys($set).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    await this.users.updateById(userId, { $set });
    return this.getProfile(userId);
  }

  async changePassword(
    authUser: AuthUser,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.users.findById(authUser.id, '+passwordHash');
    if (!user) throw new UnauthorizedException();

    if (
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      this.audit.warn(
        `user.password_change_failed user=${authUser.id} reason=bad_current_password`,
      );
      throw new ForbiddenException('Current password is incorrect');
    }
    if (await this.passwords.verify(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException(
        'New password must differ from the current one',
      );
    }

    await this.users.updateById(user._id, {
      $set: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        passwordChangedAt: new Date(),
      },
      // A reset link requested before the change must no longer work.
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    });
    // Keep the current device signed in; every other one must log in again.
    await this.sessions.revokeAllForUser(
      user._id,
      'password_changed',
      authUser.sessionId,
    );
    this.audit.log(`user.password_changed user=${authUser.id}`);
    void this.mail.sendPasswordChanged(user.email);
  }

  // ------------------------------------------------------------------ admin

  async list(query: ListUsersQueryDto): Promise<Paginated<AdminUserView>> {
    const { page, limit } = query;
    const { items, total } = await this.users.list(
      { search: query.search, role: query.role, isActive: query.isActive },
      page,
      limit,
      query.sort,
    );
    const now = new Date();
    return {
      items: items.map((u) => this.users.toAdminView(u, now)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(id: Types.ObjectId): Promise<AdminUserView> {
    return this.users.toAdminView(await this.findOrThrow(id));
  }

  async adminUpdate(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: AdminUpdateUserDto,
  ): Promise<AdminUserView> {
    const target = await this.findOrThrow(id);
    this.assertCanManage(actor, target);
    if (dto.role !== undefined) this.assertCanAssign(actor, dto.role);

    const $set: Partial<
      Pick<User, 'firstName' | 'lastName' | 'role' | 'isActive'>
    > = {};
    if (dto.firstName !== undefined) $set.firstName = dto.firstName;
    if (dto.lastName !== undefined) $set.lastName = dto.lastName;
    if (dto.role !== undefined && dto.role !== target.role) {
      $set.role = dto.role;
    }
    if (dto.isActive !== undefined && dto.isActive !== target.isActive) {
      $set.isActive = dto.isActive;
    }
    if (Object.keys($set).length === 0) {
      // Valid request that changes nothing: no write, no audit noise.
      return this.users.toAdminView(target);
    }

    const updated = await this.applyGuardedUpdate(target, { $set });

    // A role change or deactivation ends every session: the user must log in
    // again (and pass 2FA if they became privileged).
    if ($set.role !== undefined || $set.isActive === false) {
      await this.sessions.revokeAllForUser(
        target._id,
        $set.isActive === false ? 'deactivated_by_admin' : 'role_changed',
      );
    }

    // Field names only for names (PII stays out of logs); values for the
    // security-relevant ones.
    const changes = Object.keys($set)
      .map((k) =>
        k === 'role' || k === 'isActive'
          ? `${k}:${String($set[k as 'role' | 'isActive'])}`
          : k,
      )
      .join(',');
    this.audit.log(
      `user.updated actor=${actor.id} target=${target._id.toHexString()} changes=${changes}`,
    );
    return this.users.toAdminView(updated);
  }

  async unlock(actor: AuthUser, id: Types.ObjectId): Promise<AdminUserView> {
    const target = await this.findOrThrow(id);
    this.assertCanManage(actor, target);

    const updated = await this.applyGuardedUpdate(target, {
      $set: { failedLoginAttempts: 0 },
      $unset: { lockedUntil: 1 },
    });
    this.audit.log(
      `user.unlocked actor=${actor.id} target=${target._id.toHexString()}`,
    );
    return this.users.toAdminView(updated);
  }

  // --------------------------------------------------------------- helpers

  private async findOrThrow(id: Types.ObjectId): Promise<AdminUserRecord> {
    const user = await this.users.findAdminRecord(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async applyGuardedUpdate(
    target: AdminUserRecord,
    update: UpdateQuery<User>,
  ): Promise<AdminUserRecord> {
    const updated = await this.users.updateIfRole(
      target._id,
      target.role,
      update,
    );
    if (!updated) {
      throw new ConflictException(
        'The user was modified or deleted concurrently, please retry',
      );
    }
    return updated;
  }

  /**
   * Admin endpoints never act on the caller's own account (no self-promotion,
   * no locking yourself out), and only reach strictly lower ranks, except for
   * SUPER_ADMIN, who manages everyone else. Since nobody can edit their own
   * role, the last SUPER_ADMIN can never be demoted or deactivated.
   */
  private assertCanManage(actor: AuthUser, target: AdminUserRecord): void {
    if (target._id.toHexString() === actor.id) {
      throw new ForbiddenException('Use /users/me to manage your own account');
    }
    if (
      actor.role !== Role.SUPER_ADMIN &&
      ROLE_RANK[target.role] >= ROLE_RANK[actor.role]
    ) {
      throw new ForbiddenException('Insufficient permissions for this user');
    }
  }

  private assertCanAssign(actor: AuthUser, role: Role): void {
    if (
      actor.role !== Role.SUPER_ADMIN &&
      ROLE_RANK[role] >= ROLE_RANK[actor.role]
    ) {
      throw new ForbiddenException(`You cannot assign the ${role} role`);
    }
  }
}
