import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().port().default(5080),
  MONGODB_URI: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(6).required(),
  DB_NAME: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),
  CORS_ORIGIN: Joi.string().uri().optional(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
});
