import { z } from 'zod';

// Durations like "900", "30s", "15m", "12h" or "7d".
export const DURATION_REGEX = /^\d+[smhd]?$/;

export const envValidationSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(5080),
    MONGODB_URI: z.url(),
    JWT_SECRET: z.string().min(6),
    DB_NAME: z.string(),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    CORS_ORIGIN: z.url().optional(),
    JWT_EXPIRES_IN: z
      .string()
      .regex(DURATION_REGEX, 'Expected a duration like 900, 15m, 1h')
      .default('15m'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    TRUST_PROXY: z.stringbool().default(false),

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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Must be at least 32 characters in production',
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
