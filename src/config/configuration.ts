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

export interface CacheConfig {
  redisUrl?: string;
  keyPrefix: string;
  defaultTtlSeconds: number;
}

export interface Config {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  databaseUrl: string;
  dbName?: string;
  jwtSecret: string;
  logLevel: string;
  // Allowed CORS origins; undefined allows any origin (never in production).
  corsOrigins?: string[];
  trustProxy: boolean;
  swaggerEnabled: boolean;
  apiPublicUrl: string;
  auth: AuthConfig;
  mail: MailConfig;
  cache: CacheConfig;
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

// Parse through the same zod schema so defaults/coercions match validation.
export default (): Config => {
  const env = validateEnv(process.env);
  const apiPublicUrl = stripTrailingSlash(
    env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`,
  );

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.MONGODB_URI,
    jwtSecret: env.JWT_SECRET,
    dbName: env.DB_NAME,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    swaggerEnabled: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    apiPublicUrl,
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
    cache: {
      redisUrl: env.REDIS_URL,
      keyPrefix: env.REDIS_KEY_PREFIX,
      defaultTtlSeconds: env.CACHE_TTL_SECONDS,
    },
  };
};
