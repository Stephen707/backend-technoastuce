import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { resolveLogLevels } from './common/logger/log-levels';
import { Config } from './config/configuration';
import { setupSwagger, SWAGGER_PATH } from './config/swagger';

export const API_PREFIX = 'api/v1';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: resolveLogLevels(process.env.LOG_LEVEL),
  });
  const configService = app.get(ConfigService<Config, true>);
  const port = configService.get('port', { infer: true });
  const corsOrigin = configService.get('corsOrigin', { infer: true });

  // Behind a reverse proxy, trust its X-Forwarded-For so req.ip (used by the
  // rate limiter and stored on sessions) is the real client IP.
  if (configService.get('trustProxy', { infer: true })) {
    app.set('trust proxy', 1);
  }

  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({ origin: corsOrigin ?? true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  setupSwagger(app);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Server running on http://localhost:${port}/${API_PREFIX}`);
  logger.log(`Swagger docs at http://localhost:${port}/${SWAGGER_PATH}`);
}
bootstrap();
