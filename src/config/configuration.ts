import { parseDurationToSeconds } from '../common/utils/duration';
import { validateEnv } from './env.validation';

export interface AuthConfig {
  appName: string;
  appWebUrl: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  requireEmailVerification: boolean;
  twoFactorEncryptionKey: string;
}

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  dbName?: string;
  jwtSecret: string;
  logLevel: string;
  corsOrigin?: string;
  trustProxy: boolean;
  auth: AuthConfig;
  mail: MailConfig;
}

// Parse through the same zod schema so defaults/coercions match validation.
export default (): Config => {
  const env = validateEnv(process.env);

  return {
    port: env.PORT,
    databaseUrl: env.MONGODB_URI,
    jwtSecret: env.JWT_SECRET,
    dbName: env.DB_NAME,
    logLevel: env.LOG_LEVEL,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    auth: {
      appName: env.APP_NAME,
      appWebUrl: env.APP_WEB_URL,
      accessTokenTtlSeconds: parseDurationToSeconds(env.JWT_EXPIRES_IN),
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      twoFactorEncryptionKey: env.TWO_FACTOR_ENCRYPTION_KEY,
    },
    mail: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM,
    },
  };
};
