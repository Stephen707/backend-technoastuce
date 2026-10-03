import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArticlesModule } from '../articles/articles.module';
import { AuthModule } from '../auth/auth.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { VideosModule } from '../videos/videos.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DailyStat, DailyStatSchema } from './schemas/daily-stat.schema';

// Reads content through the content modules' services (never their models),
// so visibility rules stay in one place.
@Module({
  imports: [
    AuthModule,
    ArticlesModule,
    VideosModule,
    NewsletterModule,
    MongooseModule.forFeature([
      { name: DailyStat.name, schema: DailyStatSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
