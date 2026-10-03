import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArticlesModule } from './articles/articles.module';
import { AuthModule } from './auth/auth.module';
import { REDIS_CLIENT } from './cache/cache.constants';
import { AppCacheModule } from './cache/cache.module';
import { RedisThrottlerStorage } from './cache/redis-throttler.storage';
import { CommentsModule } from './comments/comments.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { UserManagementModule } from './users/user-management.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    AppCacheModule,
    // Global per-IP rate limit; sensitive routes set stricter limits with
    // @Throttle. Counters live in Redis when configured, so limits hold
    // across instances.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis | null) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: redis ? new RedisThrottlerStorage(redis) : undefined,
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UserManagementModule,
    TaxonomyModule,
    ArticlesModule,
    CommentsModule,
    VideosModule,
    NewsletterModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggerMiddleware).forRoutes('*path');
  }
}
