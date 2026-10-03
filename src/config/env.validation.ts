import { z } from 'zod';

// Durations like "900", "30s", "15m", "12h" or "7d".
export const DURATION_REGEX = /^\d+[smhd]?$/;

const isBareOrigin = (value: string) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

// "https://a.com, https://b.com" -> ['https://a.com', 'https://b.com'].
// Each entry must be a bare origin (scheme + host + optional port).
const ORIGIN_LIST = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
  .pipe(
    z
      .array(
        z.url({ protocol: /^https?$/ }).refine(isBareOrigin, {
          message: 'Each CORS origin must be scheme://host[:port], no path',
        }),
      )
      .min(1),
  );

export const envValidationSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(5080),
    MONGODB_URI: z.url(),
    JWT_SECRET: z.string().min(6),
    DB_NAME: z.string(),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    CORS_ORIGIN: ORIGIN_LIST.optional(),
    JWT_EXPIRES_IN: z
      .string()
      .regex(DURATION_REGEX, 'Expected a duration like 900, 15m, 1h')
      .default('15m'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    TRUST_PROXY: z.stringbool().default(false),
    // Defaults to enabled outside production (see superRefine below).
    SWAGGER_ENABLED: z.stringbool().optional(),
    // Public base URL of this API (used in links sent by email, e.g.
    // one-click unsubscribe). Defaults to http://localhost:PORT.
    API_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),

    // Auth
    APP_NAME: z.string().default('Technoastuce'),
    APP_WEB_URL: z.url().default('http://localhost:3000'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    AUTH_REQUIRE_EMAIL_VERIFICATION: z.stringbool().default(true),
    TWO_FACTOR_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'Must be 32 random bytes encoded in base64',
      ),

    // Mail (defaults target Mailpit)
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('Technoastuce <no-reply@technoastuce.local>'),

    // Cache. Without REDIS_URL an in-process cache is used (single instance).
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    REDIS_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9:_-]{1,32}$/i)
      .default('technoastuce:'),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Must be at least 32 characters in production',
      });
    }
    // Credentialed CORS must never reflect arbitrary origins in production.
    if (!env.CORS_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'Required in production (comma-separated list of origins)',
      });
    }
  });

export type Env = z.infer<typeof envValidationSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  // Empty values (e.g. `SMTP_USER=`) mean "not set", so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== ''),
  );
  const result = envValidationSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(
      `Config validation error:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
