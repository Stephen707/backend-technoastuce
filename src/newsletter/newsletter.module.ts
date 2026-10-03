import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { CampaignsService } from './campaigns.service';
import {
  CampaignsController,
  NewsletterController,
} from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import { Subscriber, SubscriberSchema } from './schemas/subscriber.schema';

@Module({
  imports: [
    AuthModule,
    MailModule,
    MongooseModule.forFeature([
      { name: Subscriber.name, schema: SubscriberSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
  ],
  // CampaignsController first: `/newsletter/campaigns` must not be shadowed.
  controllers: [CampaignsController, NewsletterController],
  providers: [NewsletterService, CampaignsService],
  exports: [NewsletterService],
})
export class NewsletterModule {}
