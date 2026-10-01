import { Role } from '../users/schemas/user.schema';

export const ACCESS_TOKEN_TYPE = 'access';
export const MFA_CHALLENGE_TOKEN_TYPE = 'mfa_challenge';
export const MFA_CHALLENGE_TTL_SECONDS = 300;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: Role;
  mfa: boolean;
  typ: typeof ACCESS_TOKEN_TYPE;
}

export interface MfaChallengePayload {
  sub: string;
  typ: typeof MFA_CHALLENGE_TOKEN_TYPE;
}

// What guards attach to `request.user`; role/email are re-read from the DB.
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
  mfaVerified: boolean;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}
