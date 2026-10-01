import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_TYPE, AccessTokenPayload, AuthUser } from '../auth.types';
import { SessionsService } from '../services/sessions.service';

/**
 * Validates the Bearer access token, then checks server-side that its
 * session is still active and the user still enabled. A revoked session
 * (logout, logout-all, password reset) is rejected immediately, even if
 * the JWT itself hasn't expired yet.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (payload.typ !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const [session, user] = await Promise.all([
      this.sessions.findActiveById(payload.sid),
      this.users.findById(payload.sub),
    ]);
    if (
      !session ||
      !user ||
      !user.isActive ||
      !session.userId.equals(user._id)
    ) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    request.user = {
      id: user.id as string,
      email: user.email,
      role: user.role, // from DB, so a role change applies immediately
      sessionId: payload.sid,
      mfaVerified: session.mfaVerified,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
