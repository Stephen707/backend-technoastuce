import { z } from 'zod';

export const envValidationSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(5080),
  MONGODB_URI: z.url(),
  JWT_SECRET: z.string().min(6),
  DB_NAME: z.string(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CORS_ORIGIN: z.url().optional(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export type Env = z.infer<typeof envValidationSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envValidationSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Config validation error:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
