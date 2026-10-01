import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { AuthConfig, Config } from '../../config/configuration';
import { MailService } from '../../mail/mail.service';
import {
  PRIVILEGED_ROLES,
  UserDocument,
} from '../../users/schemas/user.schema';
import { PublicUser, UsersService } from '../../users/users.service';
import {
  ACCESS_TOKEN_TYPE,
  AccessTokenPayload,
  AuthUser,
  ClientInfo,
  MFA_CHALLENGE_TOKEN_TYPE,
  MFA_CHALLENGE_TTL_SECONDS,
  MfaChallengePayload,
} from '../auth.types';
import { RegisterDto } from '../dto/register.dto';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { TotpService } from './totp.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';

// Fields needed to evaluate a login attempt.
const LOGIN_SELECT =
  '+passwordHash +failedLoginAttempts +lockedUntil +twoFactorSecret +twoFactorLastUsedStep';

export interface AuthTokens {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  // Privileged account without 2FA: it must enroll before admin access.
  twoFactorSetupRequired?: boolean;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

export type LoginResult = AuthTokens | MfaChallenge;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService<Config, true>,
  ) {
    this.authConfig = config.get('auth', { infer: true });
  }

  // ---------------------------------------------------------------- register

  async register(dto: RegisterDto): Promise<PublicUser> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const token = generateToken();
    const user = await this.users.create({
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      firstName: dto.firstName,
      lastName: dto.lastName,
      emailVerificationTokenHash: sha256(token),
      emailVerificationExpiresAt: new Date(
        Date.now() + EMAIL_VERIFICATION_TTL_MS,
      ),
    });

    await this.mail.sendEmailVerification(user.email, token);
    return this.users.toPublic(user);
  }

  // ------------------------------------------------------------------- login

  async login(
    email: string,
    password: string,
    client: ClientInfo,
  ): Promise<LoginResult> {
    const user = await this.users.findByEmail(email, LOGIN_SELECT);

    // Always run argon2 (against a dummy hash if needed) for constant timing.
    const passwordOk = await this.passwords.verify(
      user?.passwordHash,
      password,
    );

    if (!user || !user.isActive)
      throw new UnauthorizedException(INVALID_CREDENTIALS);

    // Locked accounts get the same answer as a wrong password, so the lock
    // can't be used to probe which emails exist.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!passwordOk) {
      await this.registerFailedAttempt(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (this.authConfig.requireEmailVerification && !user.emailVerified) {
      throw new ForbiddenException(
        'Email address not verified. Check your inbox or request a new link.',
      );
    }

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updateById(user._id, {
        passwordHash: await this.passwords.hash(password),
      });
    }

    if (user.twoFactorEnabled) {
      // Password OK, but the account isn't unlocked until the TOTP step.
      const payload: MfaChallengePayload = {
        sub: user.id as string,
        typ: MFA_CHALLENGE_TOKEN_TYPE,
      };
      return {
        mfaRequired: true,
        mfaToken: await this.jwt.signAsync(payload, {
          expiresIn: MFA_CHALLENGE_TTL_SECONDS,
        }),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      };
    }

    return this.completeLogin(user, client, false);
  }

  async verifyMfaLogin(
    mfaToken: string,
    code: string,
    client: ClientInfo,
  ): Promise<AuthTokens> {
    let payload: MfaChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<MfaChallengePayload>(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    if (payload.typ !== MFA_CHALLENGE_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    const user = await this.users.findById(payload.sub, LOGIN_SELECT);
    if (
      !user ||
      !user.isActive ||
      !user.twoFactorEnabled ||
      !user.twoFactorSecret ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    // Wrong codes count toward the same lockout as wrong passwords.
    if (!(await this.checkTotp(user, code))) {
      await this.registerFailedAttempt(user);
      throw new UnauthorizedException('Invalid two-factor code');
    }

    return this.completeLogin(user, client, true);
  }

  private async completeLogin(
    user: UserDocument,
    client: ClientInfo,
    mfaVerified: boolean,
  ): Promise<AuthTokens> {
    await this.users.updateById(user._id, {
      $set: { failedLoginAttempts: 0, lastLoginAt: new Date() },
      $unset: { lockedUntil: 1 },
    });

    const { session, refreshToken } = await this.sessions.create(
      user._id,
      client,
      mfaVerified,
    );
    const result: AuthTokens = {
      user: this.users.toPublic(user),
      accessToken: await this.signAccessToken(
        user,
        session.id as string,
        mfaVerified,
      ),
      refreshToken,
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    };
    if (PRIVILEGED_ROLES.includes(user.role) && !user.twoFactorEnabled) {
      result.twoFactorSetupRequired = true;
    }
    return result;
  }

  private async registerFailedAttempt(user: UserDocument): Promise<void> {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      this.logger.warn(
        `Account ${user.id} locked after ${attempts} failed attempts`,
      );
      await this.users.updateById(user._id, {
        $set: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
        },
      });
    } else {
      await this.users.updateById(user._id, {
        $inc: { failedLoginAttempts: 1 },
      });
    }
  }

  private signAccessToken(
    user: UserDocument,
    sessionId: string,
    mfa: boolean,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id as string,
      sid: sessionId,
      role: user.role,
      mfa,
      typ: ACCESS_TOKEN_TYPE,
    };
    return this.jwt.signAsync(payload, {
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    });
  }

  // ------------------------------------------------------- refresh / logout

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthTokens> {
    const { session, refreshToken: newRefreshToken } =
      await this.sessions.rotate(refreshToken, client);

    const user = await this.users.findById(session.userId);
    if (!user || !user.isActive) {
      await this.sessions.revokeForUser(
        session.userId,
        session.id as string,
        'user_inactive',
      );
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      user: this.users.toPublic(user),
      accessToken: await this.signAccessToken(
        user,
        session.id as string,
        session.mfaVerified,
      ),
      refreshToken: newRefreshToken,
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    };
  }

  // Idempotent: an unknown/already revoked token is not an error.
  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revokeByRefreshToken(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId, 'logout_all');
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.sessions.revokeForUser(
      userId,
      sessionId,
      'revoked_by_user',
    );
    // 404 also for other users' sessions: never confirm they exist.
    if (!revoked) throw new NotFoundException('Session not found');
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.users.toPublic(user);
  }

  // ------------------------------------------------------ password reset

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) return; // same response either way

    const token = generateToken();
    await this.users.updateById(user._id, {
      passwordResetTokenHash: sha256(token),
      passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });
    // Not awaited: response time must not depend on whether the user exists.
    void this.mail.sendPasswordReset(user.email, token);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    const user = await this.users.consumeToken(
      'passwordResetTokenHash',
      'passwordResetExpiresAt',
      sha256(token),
      {
        $set: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          // The link was received by email, which proves ownership.
          emailVerified: true,
        },
        $unset: { lockedUntil: 1 },
      },
    );
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    await this.sessions.revokeAllForUser(user._id, 'password_reset');
    void this.mail.sendPasswordChanged(user.email);
  }

  // -------------------------------------------------- email verification

  async verifyEmail(token: string): Promise<void> {
    const user = await this.users.consumeToken(
      'emailVerificationTokenHash',
      'emailVerificationExpiresAt',
      sha256(token),
      { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
    );
    if (!user)
      throw new BadRequestException('Invalid or expired verification token');
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.emailVerified) return; // same response either way

    const token = generateToken();
    await this.users.updateById(user._id, {
      emailVerificationTokenHash: sha256(token),
      emailVerificationExpiresAt: new Date(
        Date.now() + EMAIL_VERIFICATION_TTL_MS,
      ),
    });
    void this.mail.sendEmailVerification(user.email, token);
  }

  // ------------------------------------------------------- TOTP (2FA)

  async setupTwoFactor(
    authUser: AuthUser,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.users.findById(authUser.id);
    if (!user) throw new UnauthorizedException();
    if (user.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }

    // Stored as "pending" until the user proves their app works (enable).
    const secret = this.totp.generateSecret();
    await this.users.updateById(user._id, {
      twoFactorPendingSecret: this.totp.encrypt(secret),
    });
    return {
      secret,
      otpauthUrl: this.totp.buildOtpAuthUrl(secret, user.email),
    };
  }

  async enableTwoFactor(authUser: AuthUser, code: string): Promise<void> {
    const user = await this.users.findById(
      authUser.id,
      '+twoFactorPendingSecret +twoFactorLastUsedStep',
    );
    if (!user) throw new UnauthorizedException();
    if (user.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }
    if (!user.twoFactorPendingSecret) {
      throw new BadRequestException('Call /auth/2fa/setup first');
    }

    const secret = this.totp.decrypt(user.twoFactorPendingSecret);
    const step = this.totp.verify(secret, code);
    if (step === null) throw new BadRequestException('Invalid two-factor code');

    await this.users.updateById(user._id, {
      $set: {
        twoFactorEnabled: true,
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorLastUsedStep: step,
      },
      $unset: { twoFactorPendingSecret: 1 },
    });
    // The current session just proved possession of the second factor;
    // every other session must log in again with 2FA.
    await this.sessions.markMfaVerified(authUser.sessionId);
    await this.sessions.revokeAllForUser(
      user._id,
      'two_factor_enabled',
      authUser.sessionId,
    );
  }

  async disableTwoFactor(
    authUser: AuthUser,
    password: string,
    code: string,
  ): Promise<void> {
    const user = await this.users.findById(authUser.id, LOGIN_SELECT);
    if (!user) throw new UnauthorizedException();
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new ForbiddenException('Invalid password');
    }
    if (!(await this.checkTotp(user, code))) {
      throw new ForbiddenException('Invalid two-factor code');
    }

    await this.users.updateById(user._id, {
      $set: { twoFactorEnabled: false },
      $unset: { twoFactorSecret: 1, twoFactorLastUsedStep: 1 },
    });
  }

  // Verifies a code against the active secret and records its time-step.
  private async checkTotp(user: UserDocument, code: string): Promise<boolean> {
    if (!user.twoFactorSecret) return false;
    const step = this.totp.verify(
      this.totp.decrypt(user.twoFactorSecret),
      code,
      user.twoFactorLastUsedStep,
    );
    return step !== null && this.users.claimTotpStep(user._id, step);
  }
}
