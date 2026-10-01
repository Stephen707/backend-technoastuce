import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { Config } from '../../config/configuration';
import { ClientInfo } from '../auth.types';
import {
  AuthSession,
  AuthSessionDocument,
} from '../schemas/auth-session.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_REFRESH = 'Invalid or expired refresh token';

export interface SessionView {
  id: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
}

// Refresh token format: "<sessionId>.<random>". The id prefix makes lookup a
// primary-key read; only the SHA-256 of the whole token is stored.
function buildRefreshToken(sessionId: string): string {
  return `${sessionId}.${generateToken(48)}`;
}

function parseRefreshToken(token: string): string | null {
  const [sessionId, secret] = token.split('.');
  return secret && isValidObjectId(sessionId) ? sessionId : null;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly ttlMs: number;

  constructor(
    @InjectModel(AuthSession.name)
    private readonly sessionModel: Model<AuthSession>,
    config: ConfigService<Config, true>,
  ) {
    this.ttlMs =
      config.get('auth', { infer: true }).refreshTokenTtlDays * DAY_MS;
  }

  async create(
    userId: Types.ObjectId,
    client: ClientInfo,
    mfaVerified: boolean,
  ): Promise<{ session: AuthSessionDocument; refreshToken: string }> {
    const _id = new Types.ObjectId();
    const refreshToken = buildRefreshToken(_id.toHexString());
    const session = await this.sessionModel.create({
      _id,
      userId,
      refreshTokenHash: sha256(refreshToken),
      mfaVerified,
      expiresAt: new Date(Date.now() + this.ttlMs),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 512),
    });
    return { session, refreshToken };
  }

  /**
   * Rotates the refresh token. The update is conditional on the current
   * hash, so two concurrent requests can't both succeed. If a token that
   * was already rotated is presented again, it was likely stolen: the whole
   * session is revoked (refresh token reuse detection).
   */
  async rotate(
    refreshToken: string,
    client: ClientInfo,
  ): Promise<{ session: AuthSessionDocument; refreshToken: string }> {
    const sessionId = parseRefreshToken(refreshToken);
    if (!sessionId) throw new UnauthorizedException(INVALID_REFRESH);

    const now = new Date();
    const newToken = buildRefreshToken(sessionId);
    const session = await this.sessionModel
      .findOneAndUpdate(
        {
          _id: sessionId,
          refreshTokenHash: sha256(refreshToken),
          revokedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        {
          $set: {
            refreshTokenHash: sha256(newToken),
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + this.ttlMs),
            ip: client.ip,
            userAgent: client.userAgent?.slice(0, 512),
          },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (session) return { session, refreshToken: newToken };

    const reused = await this.sessionModel
      .findOneAndUpdate(
        {
          _id: sessionId,
          revokedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        { $set: { revokedAt: now, revokedReason: 'refresh_token_reuse' } },
      )
      .exec();
    if (reused) {
      this.logger.warn(
        `Refresh token reuse detected, session ${sessionId} revoked (user ${reused.userId.toHexString()})`,
      );
    }
    throw new UnauthorizedException(INVALID_REFRESH);
  }

  findActiveById(sessionId: string) {
    if (!isValidObjectId(sessionId)) return Promise.resolve(null);
    return this.sessionModel
      .findOne({
        _id: sessionId,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .lean()
      .exec();
  }

  // Returns false when the token does not match an active session.
  async revokeByRefreshToken(refreshToken: string): Promise<boolean> {
    const sessionId = parseRefreshToken(refreshToken);
    if (!sessionId) return false;
    const res = await this.sessionModel
      .updateOne(
        {
          _id: sessionId,
          refreshTokenHash: sha256(refreshToken),
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
      )
      .exec();
    return res.modifiedCount > 0;
  }

  async revokeForUser(
    userId: string | Types.ObjectId,
    sessionId: string,
    reason: string,
  ): Promise<boolean> {
    if (!isValidObjectId(sessionId)) return false;
    const res = await this.sessionModel
      .updateOne(
        { _id: sessionId, userId, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
      )
      .exec();
    return res.modifiedCount > 0;
  }

  async revokeAllForUser(
    userId: string | Types.ObjectId,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const filter: Record<string, unknown> = {
      userId,
      revokedAt: { $exists: false },
    };
    if (exceptSessionId) filter._id = { $ne: exceptSessionId };
    const res = await this.sessionModel
      .updateMany(filter, {
        $set: { revokedAt: new Date(), revokedReason: reason },
      })
      .exec();
    return res.modifiedCount;
  }

  markMfaVerified(sessionId: string) {
    return this.sessionModel
      .updateOne({ _id: sessionId }, { $set: { mfaVerified: true } })
      .exec();
  }

  async listActive(
    userId: string | Types.ObjectId,
    currentSessionId: string,
  ): Promise<SessionView[]> {
    const sessions = await this.sessionModel
      .find({
        userId,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ lastUsedAt: -1 })
      .lean()
      .exec();

    // refreshTokenHash is `select: false`, so no token data is ever listed.
    return sessions.map((s) => ({
      id: s._id.toHexString(),
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: s._id.toHexString() === currentSessionId,
    }));
  }
}
