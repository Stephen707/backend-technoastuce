import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PRIVILEGED_ROLES, Role } from '../../users/schemas/user.schema';
import { AuthUser } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Use after JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 * Privileged roles (ADMIN, SUPER_ADMIN) must also have a session that
 * passed TOTP, otherwise they are told to set up / use 2FA.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (PRIVILEGED_ROLES.includes(user.role) && !user.mfaVerified) {
      throw new ForbiddenException(
        'Two-factor authentication is required for this account',
      );
    }
    return true;
  }
}
