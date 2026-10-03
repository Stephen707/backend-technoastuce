import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { resolveLogLevels } from './common/logger/log-levels';
import { Config } from './config/configuration';
import { API_PREFIX, JSON_BODY_LIMIT } from './config/http';
import { setupSwagger, SWAGGER_PATH } from './config/swagger';

export { API_PREFIX, JSON_BODY_LIMIT };

const ONE_YEAR_SECONDS = 365 * 24 * 3600;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: resolveLogLevels(process.env.LOG_LEVEL),
  });
  const configService = app.get(ConfigService<Config, true>);
  const port = configService.get('port', { infer: true });
  const isProduction =
    configService.get('nodeEnv', { infer: true }) === 'production';
  const swaggerEnabled = configService.get('swaggerEnabled', { infer: true });
  const corsOrigins = configService.get('corsOrigins', { infer: true });

  // Behind a reverse proxy, trust its X-Forwarded-For so req.ip (used by the
  // rate limiter and stored on sessions) is the real client IP.
  if (configService.get('trustProxy', { infer: true })) {
    app.set('trust proxy', 1);
  }
  // Flat query strings only (Express 5 default, made explicit): `a[b]=c`
  // never becomes an object, so no Mongo operator can come from a query.
  app.set('query parser', 'simple');

  app.setGlobalPrefix(API_PREFIX);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Only RFC 8058 one-click unsubscribe posts forms; no nested objects.
  app.useBodyParser('urlencoded', { limit: '16kb', extended: false });

  app.use(
    helmet({
      // JSON API: nothing to load or frame. Swagger UI needs helmet's
      // default policy (same-origin scripts), so keep it when enabled.
      contentSecurityPolicy: swaggerEnabled
        ? undefined
        : {
            useDefaults: false,
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          },
      // HSTS only in production (HTTPS); preload is a separate, opt-in
      // commitment.
      strictTransportSecurity: isProduction
        ? { maxAge: 2 * ONE_YEAR_SECONDS, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // Strict CORS: an explicit origin list (required in production, see
  // env.validation). Without one, development reflects any origin.
  app.enableCors({
    origin: corsOrigins ?? !isProduction,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (swaggerEnabled) setupSwagger(app);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Server running on http://localhost:${port}/${API_PREFIX}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs at http://localhost:${port}/${SWAGGER_PATH}`);
  }
}
bootstrap();
