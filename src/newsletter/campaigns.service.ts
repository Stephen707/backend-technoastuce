import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, toPage } from '../common/types/paginated';
import { richTextToPlainText } from '../common/utils/rich-text';
import { MailService } from '../mail/mail.service';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  UpdateCampaignDto,
} from './dto/newsletter.dto';
import {
  CampaignRecord,
  CampaignSummaryView,
  CampaignView,
} from './newsletter.types';
import { Campaign, CampaignStatus } from './schemas/campaign.schema';
import { Subscriber, SubscriberStatus } from './schemas/subscriber.schema';

const SUMMARY_PROJECTION =
  'subject status recipientCount sentCount failedCount startedAt finishedAt createdBy createdAt updatedAt';
const DETAIL_PROJECTION = `${SUMMARY_PROJECTION} content`;

// Emails sent in parallel; progress is saved after each batch.
export const DELIVERY_BATCH_SIZE = 20;

export function toCampaignSummaryView(c: CampaignRecord): CampaignSummaryView {
  return {
    id: c._id.toHexString(),
    subject: c.subject,
    status: c.status,
    recipientCount: c.recipientCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    createdBy: c.createdBy.toHexString(),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Newsletter campaigns. Sending is asynchronous: `send` flips the campaign
 * from DRAFT to SENDING atomically (a second click gets a 409, never a
 * second mailing) and returns at once; delivery then walks the confirmed
 * subscribers with a cursor, in small parallel batches.
 */
@Injectable()
export class CampaignsService implements OnApplicationShutdown {
  private readonly audit = new Logger('Audit');
  private readonly logger = new Logger('Newsletter');
  private readonly deliveries = new Set<Promise<void>>();

  constructor(
    @InjectModel(Campaign.name) private readonly model: Model<Campaign>,
    @InjectModel(Subscriber.name)
    private readonly subscribers: Model<Subscriber>,
    private readonly mail: MailService,
  ) {}

  async list(query: ListCampaignsQueryDto): Promise<Paginated<CampaignSummaryView>> {
    const { page, limit } = query;
    const filter: QueryFilter<Campaign> = {};
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(SUMMARY_PROJECTION)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CampaignRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPage(items.map(toCampaignSummaryView), total, page, limit);
  }

  async getById(id: Types.ObjectId): Promise<CampaignView> {
    const c = await this.model
      .findById(id)
      .select(DETAIL_PROJECTION)
      .lean<CampaignRecord>()
      .exec();
    if (!c) throw new NotFoundException('Campaign not found');
    return { ...toCampaignSummaryView(c), content: c.content ?? '' };
  }

  async create(actor: AuthUser, dto: CreateCampaignDto): Promise<CampaignView> {
    const doc = await this.model.create({
      subject: dto.subject,
      content: dto.content,
      createdBy: new Types.ObjectId(actor.id),
    });
    this.audit.log(
      `campaign.created actor=${actor.id} id=${doc._id.toHexString()}`,
    );
    return this.getById(doc._id);
  }

  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateCampaignDto,
  ): Promise<CampaignView> {
    const $set: Partial<Pick<Campaign, 'subject' | 'content'>> = {};
    if (dto.subject !== undefined) $set.subject = dto.subject;
    if (dto.content !== undefined) $set.content = dto.content;
    if (Object.keys($set).length > 0) {
      const res = await this.model
        .updateOne({ _id: id, status: CampaignStatus.DRAFT }, { $set }, {
          runValidators: true,
        })
        .exec();
      if (res.matchedCount === 0) await this.throwNotDraft(id);
      this.audit.log(
        `campaign.updated actor=${actor.id} id=${id.toHexString()} changes=${Object.keys($set).join(',')}`,
      );
    }
    return this.getById(id);
  }

  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const res = await this.model
      .deleteOne({ _id: id, status: CampaignStatus.DRAFT })
      .exec();
    if (res.deletedCount === 0) await this.throwNotDraft(id);
    this.audit.log(`campaign.deleted actor=${actor.id} id=${id.toHexString()}`);
  }

  async send(actor: AuthUser, id: Types.ObjectId): Promise<CampaignView> {
    const recipientCount = await this.subscribers
      .countDocuments({ status: SubscriberStatus.CONFIRMED })
      .exec();
    const claimed = await this.model
      .findOneAndUpdate(
        { _id: id, status: CampaignStatus.DRAFT },
        {
          $set: {
            status: CampaignStatus.SENDING,
            recipientCount,
            startedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .select('subject content')
      .lean<Pick<CampaignRecord, '_id' | 'subject' | 'content'>>()
      .exec();
    if (!claimed) return this.throwNotDraft(id);

    this.audit.log(
      `campaign.sent actor=${actor.id} id=${id.toHexString()} recipients=${recipientCount}`,
    );
    const delivery = this.deliver(id, claimed.subject, claimed.content ?? '');
    this.deliveries.add(delivery);
    void delivery.finally(() => this.deliveries.delete(delivery));
    return this.getById(id);
  }

  // Resolves once every delivery in progress has finished (tests, shutdown).
  async whenIdle(): Promise<void> {
    await Promise.all(this.deliveries);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  // Never rejects: failures end up in the campaign's status and counters.
  private async deliver(
    id: Types.ObjectId,
    subject: string,
    html: string,
  ): Promise<void> {
    const text = richTextToPlainText(html);
    let status = CampaignStatus.SENT;
    try {
      const cursor = this.subscribers
        .find({ status: SubscriberStatus.CONFIRMED })
        .select('email +unsubscribeToken')
        .sort({ _id: 1 })
        .lean<{ email: string; unsubscribeToken: string }[]>()
        .cursor({ batchSize: 200 });

      let batch: { email: string; unsubscribeToken: string }[] = [];
      const flush = async () => {
        const results = await Promise.all(
          batch.map((s) =>
            this.mail.sendCampaign({
              to: s.email,
              subject,
              html,
              text,
              unsubscribeToken: s.unsubscribeToken,
            }),
          ),
        );
        const sent = results.filter(Boolean).length;
        batch = [];
        await this.model
          .updateOne(
            { _id: id },
            { $inc: { sentCount: sent, failedCount: results.length - sent } },
          )
          .exec();
      };

      for await (const subscriber of cursor) {
        batch.push(subscriber as { email: string; unsubscribeToken: string });
        if (batch.length >= DELIVERY_BATCH_SIZE) await flush();
      }
      if (batch.length > 0) await flush();
    } catch (err) {
      status = CampaignStatus.FAILED;
      this.logger.error(
        `Campaign ${id.toHexString()} delivery failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    await this.model
      .updateOne({ _id: id }, { $set: { status, finishedAt: new Date() } })
      .exec()
      .catch(() => undefined);
    this.logger.log(`campaign.finished id=${id.toHexString()} status=${status}`);
  }

  private async throwNotDraft(id: Types.ObjectId): Promise<never> {
    if (await this.model.exists({ _id: id })) {
      throw new ConflictException('Only a draft campaign can be changed or sent');
    }
    throw new NotFoundException('Campaign not found');
  }
}
