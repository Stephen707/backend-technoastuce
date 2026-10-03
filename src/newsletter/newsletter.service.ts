import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, toPage } from '../common/types/paginated';
import { generateToken, sha256 } from '../common/utils/crypto';
import { escapeRegex } from '../common/utils/regex';
import { MailService } from '../mail/mail.service';
import { parseSort } from '../taxonomy/taxonomy.utils';
import { ListSubscribersQueryDto, SubscribeDto } from './dto/newsletter.dto';
import {
  SubscriberRecord,
  SubscriberStats,
  SubscriberView,
} from './newsletter.types';
import { Subscriber, SubscriberStatus } from './schemas/subscriber.schema';

export const CONFIRM_TOKEN_TTL_MS = 48 * 3600 * 1000;
// At most one confirmation email per address in this window.
export const CONFIRM_RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const PROJECTION =
  'email status source confirmedAt unsubscribedAt createdAt updatedAt';

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

export function toSubscriberView(s: SubscriberRecord): SubscriberView {
  return {
    id: s._id.toHexString(),
    email: s.email,
    status: s.status,
    source: s.source ?? null,
    confirmedAt: s.confirmedAt ?? null,
    unsubscribedAt: s.unsubscribedAt ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/**
 * Newsletter subscriptions with double opt-in.
 *
 * `subscribe` behaves the same whatever the state of the address (new,
 * pending, confirmed, unsubscribed): same response, and the email is sent
 * in the background, so the endpoint can't be used to find out who is
 * subscribed. Emails never appear in logs (subscriber ids do).
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger('Newsletter');
  private readonly audit = new Logger('Audit');

  constructor(
    @InjectModel(Subscriber.name) private readonly model: Model<Subscriber>,
    private readonly mail: MailService,
  ) {}

  // ----------------------------------------------------------------- public

  async subscribe(dto: SubscribeDto, now = new Date()): Promise<void> {
    const token = generateToken();
    let subscriber: { _id: Types.ObjectId } | null;
    try {
      // Matches unless already confirmed, or a confirmation went out
      // recently; then an upsert either revives the record or inserts it.
      // A duplicate-key error means one of those two cases (or a
      // concurrent request): nothing to do.
      subscriber = await this.model
        .findOneAndUpdate(
          {
            email: dto.email,
            status: { $ne: SubscriberStatus.CONFIRMED },
            $or: [
              { confirmationSentAt: { $exists: false } },
              {
                confirmationSentAt: {
                  $lte: new Date(now.getTime() - CONFIRM_RESEND_COOLDOWN_MS),
                },
              },
              { status: SubscriberStatus.UNSUBSCRIBED },
            ],
          },
          {
            $set: {
              status: SubscriberStatus.PENDING,
              confirmTokenHash: sha256(token),
              confirmTokenExpiresAt: new Date(
                now.getTime() + CONFIRM_TOKEN_TTL_MS,
              ),
              confirmationSentAt: now,
              ...(dto.source ? { source: dto.source } : {}),
            },
            $unset: { unsubscribedAt: 1 },
            // `email` comes from the filter on insert.
            $setOnInsert: { unsubscribeToken: generateToken() },
          },
          { upsert: true, returnDocument: 'after', runValidators: true },
        )
        .select('_id')
        .lean<{ _id: Types.ObjectId }>()
        .exec();
    } catch (err) {
      if (isDuplicateKeyError(err)) return;
      throw err;
    }
    if (!subscriber) return;

    this.logger.log(
      `newsletter.confirmation_sent id=${subscriber._id.toHexString()}`,
    );
    // Not awaited: response time must not depend on the address' state.
    void this.mail.sendNewsletterConfirmation(dto.email, token);
  }

  async confirm(token: string, now = new Date()): Promise<void> {
    const res = await this.model
      .findOneAndUpdate(
        {
          confirmTokenHash: sha256(token),
          confirmTokenExpiresAt: { $gt: now },
          status: SubscriberStatus.PENDING,
        },
        {
          $set: { status: SubscriberStatus.CONFIRMED, confirmedAt: now },
          $unset: { confirmTokenHash: 1, confirmTokenExpiresAt: 1 },
        },
      )
      .select('_id')
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    if (!res) {
      throw new BadRequestException('Invalid or expired confirmation link');
    }
    this.logger.log(`newsletter.confirmed id=${res._id.toHexString()}`);
  }

  // Idempotent: unsubscribing twice with a valid token is fine.
  async unsubscribe(token: string, now = new Date()): Promise<void> {
    const res = await this.model
      .findOneAndUpdate(
        { unsubscribeToken: token },
        [
          {
            $set: {
              status: SubscriberStatus.UNSUBSCRIBED,
              unsubscribedAt: { $ifNull: ['$unsubscribedAt', now] },
            },
          },
          { $unset: ['confirmTokenHash', 'confirmTokenExpiresAt'] },
        ],
        // Pipeline values are a constant status and a server-side Date.
        { updatePipeline: true },
      )
      .select('_id status')
      .lean<{ _id: Types.ObjectId; status: SubscriberStatus }>()
      .exec();
    if (!res) throw new BadRequestException('Invalid unsubscribe link');
    if (res.status !== SubscriberStatus.UNSUBSCRIBED) {
      this.logger.log(`newsletter.unsubscribed id=${res._id.toHexString()}`);
    }
  }

  // ------------------------------------------------------------------ admin

  async list(query: ListSubscribersQueryDto): Promise<Paginated<SubscriberView>> {
    const { page, limit } = query;
    const filter: QueryFilter<Subscriber> = {};
    if (query.status) filter.status = query.status;
    // Emails are stored lowercase, so an anchored prefix uses the index.
    if (query.search) filter.email = { $regex: `^${escapeRegex(query.search)}` };
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(PROJECTION)
        .sort(parseSort(query.sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SubscriberRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPage(items.map(toSubscriberView), total, page, limit);
  }

  async stats(): Promise<SubscriberStats> {
    const rows = await this.model
      .aggregate<{ _id: SubscriberStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
    const stats: SubscriberStats = {
      [SubscriberStatus.PENDING]: 0,
      [SubscriberStatus.CONFIRMED]: 0,
      [SubscriberStatus.UNSUBSCRIBED]: 0,
      total: 0,
    };
    for (const row of rows) {
      stats[row._id] = row.count;
      stats.total += row.count;
    }
    return stats;
  }

  // Hard delete (right to erasure), unlike unsubscribe which keeps a trace.
  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const res = await this.model.deleteOne({ _id: id }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('Subscriber not found');
    }
    this.audit.log(
      `newsletter.subscriber_deleted actor=${actor.id} id=${id.toHexString()}`,
    );
  }
}
