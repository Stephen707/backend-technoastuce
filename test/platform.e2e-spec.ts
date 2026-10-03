import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import {
  getModelToken,
  MongooseModule,
  MongooseModuleOptions,
} from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import request from 'supertest';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { DailyStat } from '../src/analytics/schemas/daily-stat.schema';
import { AuthUser } from '../src/auth/auth.types';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AppCacheModule } from '../src/cache/cache.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import configuration from '../src/config/configuration';
import { CampaignEmail, MailService } from '../src/mail/mail.service';
import { CampaignsService } from '../src/newsletter/campaigns.service';
import { NewsletterModule } from '../src/newsletter/newsletter.module';
import { Subscriber } from '../src/newsletter/schemas/subscriber.schema';
import { Role, User } from '../src/users/schemas/user.schema';
import { Video } from '../src/videos/schemas/video.schema';
import { VideosModule } from '../src/videos/videos.module';

/**
 * HTTP integration test of videos, newsletter and analytics against
 * an in-memory MongoDB, with the production validation pipe, exception
 * filter and RolesGuard. JwtAuthGuard is stubbed (`x-test-user` header)
 * and MailService is replaced by a recorder.
 */
const USERS: Record<string, AuthUser> = {
  admin: {
    id: new Types.ObjectId().toHexString(),
    email: 'admin@test.local',
    role: Role.ADMIN,
    sessionId: 's1',
    mfaVerified: true,
  },
  'admin-no-2fa': {
    id: new Types.ObjectId().toHexString(),
    email: 'admin2@test.local',
    role: Role.ADMIN,
    sessionId: 's2',
    mfaVerified: false,
  },
  alice: {
    id: new Types.ObjectId().toHexString(),
    email: 'alice@test.local',
    role: Role.USER,
    sessionId: 's3',
    mfaVerified: false,
  },
};

class StubJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    const user = USERS[req.headers['x-test-user'] ?? ''];
    if (!user) throw new UnauthorizedException('Missing access token');
    req.user = user;
    return true;
  }
}

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const YT = 'dQw4w9WgXcQ';

describe('Videos, newsletter & analytics (HTTP integration)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const api = '/api/v1';
  const as = (who: keyof typeof USERS) => ({ 'x-test-user': who });

  const mail = {
    confirmations: [] as { to: string; token: string }[],
    campaigns: [] as CampaignEmail[],
    sendNewsletterConfirmation: jest.fn((to: string, token: string) => {
      mail.confirmations.push({ to, token });
      return Promise.resolve();
    }),
    sendCampaign: jest.fn((email: CampaignEmail) => {
      mail.campaigns.push(email);
      return Promise.resolve(!email.to.startsWith('bounce'));
    }),
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      DB_NAME: 'platform-test',
      JWT_SECRET: randomBytes(32).toString('hex'),
      TWO_FACTOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NODE_ENV: 'test',
      API_PUBLIC_URL: 'https://api.example.com',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri(), {
          dbName: 'platform-test',
          // See taxonomy.e2e-spec.ts: the driver's dynamic import of `os`
          // fails in Jest's CommonJS sandbox.
          runtimeAdapters: { os },
        } as MongooseModuleOptions),
        AppCacheModule,
        VideosModule,
        NewsletterModule,
        AnalyticsModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtAuthGuard)
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    // Same setup as main.ts / AppModule.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();

    for (const name of [Video.name, Subscriber.name, DailyStat.name]) {
      await app.get<Model<unknown>>(getModelToken(name)).syncIndexes();
    }
    await app.get<Model<User>>(getModelToken(User.name)).insertMany([
      {
        _id: USERS.admin.id,
        email: USERS.admin.email,
        passwordHash: 'x',
        firstName: 'Ada',
        role: Role.ADMIN,
      },
    ]);

    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('access control', () => {
    const id = new Types.ObjectId().toHexString();

    it.each([
      ['get', '/videos/admin'],
      ['post', '/videos'],
      ['patch', `/videos/${id}`],
      ['get', '/newsletter/subscribers'],
      ['get', '/newsletter/subscribers/stats'],
      ['post', '/newsletter/campaigns'],
      ['post', `/newsletter/campaigns/${id}/send`],
      ['get', '/analytics/overview'],
    ] as const)(
      '%s %s: 401 anonymous, 403 user, 403 admin without 2FA',
      async (method, path) => {
        await http[method](`${api}${path}`).expect(401);
        await http[method](`${api}${path}`).set(as('alice')).expect(403);
        await http[method](`${api}${path}`)
          .set(as('admin-no-2fa'))
          .expect(403);
      },
    );
  });

  describe('videos', () => {
    let videoId: string;

    it('creates a draft from a YouTube link, hidden from the public', async () => {
      const res = await http
        .post(`${api}/videos`)
        .set(as('admin'))
        .send({
          title: 'Désactiver la télémétrie',
          url: `https://youtu.be/${YT}?si=tracking`,
          description: 'Pas à pas.',
        })
        .expect(201);
      videoId = res.body.id as string;
      expect(res.body).toMatchObject({
        slug: 'desactiver-la-telemetrie',
        provider: 'YOUTUBE',
        providerVideoId: YT,
        embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
        status: 'DRAFT',
        publishedAt: null,
      });
      await http.get(`${api}/videos/slug/desactiver-la-telemetrie`).expect(404);
      const list = await http.get(`${api}/videos`).expect(200);
      expect(list.body.total).toBe(0);
    });

    it('rejects the same video twice, foreign hosts and mass assignment', async () => {
      await http
        .post(`${api}/videos`)
        .set(as('admin'))
        .send({ title: 'Doublon', url: `https://www.youtube.com/watch?v=${YT}` })
        .expect(409);
      await http
        .post(`${api}/videos`)
        .set(as('admin'))
        .send({ title: 'Ailleurs', url: 'https://evil.example.com/watch?v=x' })
        .expect(400);
      await http
        .post(`${api}/videos`)
        .set(as('admin'))
        .send({ title: 'Iframe', url: `https://youtu.be/${YT}`, embedUrl: 'https://evil.example.com' })
        .expect(400);
    });

    it('publishes, then serves fresh data after each write despite the cache', async () => {
      await http
        .patch(`${api}/videos/${videoId}`)
        .set(as('admin'))
        .send({ status: 'PUBLISHED' })
        .expect(200);

      const first = await http
        .get(`${api}/videos/slug/desactiver-la-telemetrie`)
        .expect(200);
      expect(first.headers['cache-control']).toBe('public, max-age=60');
      expect(first.body.title).toBe('Désactiver la télémétrie');
      expect((await http.get(`${api}/videos`).expect(200)).body.total).toBe(1);

      await http
        .patch(`${api}/videos/${videoId}`)
        .set(as('admin'))
        .send({ title: 'Télémétrie : le guide' })
        .expect(200);
      const second = await http
        .get(`${api}/videos/slug/desactiver-la-telemetrie`)
        .expect(200);
      expect(second.body.title).toBe('Télémétrie : le guide');
    });
  });

  describe('newsletter', () => {
    const email = 'reader@example.com';

    it('double opt-in: same answer every time, one email per cooldown', async () => {
      const answer = await http
        .post(`${api}/newsletter/subscribe`)
        .send({ email: ' Reader@Example.com ', source: 'footer' })
        .expect(202);
      await new Promise((r) => setImmediate(r));
      expect(mail.confirmations).toHaveLength(1);
      expect(mail.confirmations[0].to).toBe(email);

      const again = await http
        .post(`${api}/newsletter/subscribe`)
        .send({ email })
        .expect(202);
      expect(again.body).toEqual(answer.body);
      expect(mail.confirmations).toHaveLength(1);

      const stats = await http
        .get(`${api}/newsletter/subscribers/stats`)
        .set(as('admin'))
        .expect(200);
      expect(stats.body).toEqual({ PENDING: 1, CONFIRMED: 0, UNSUBSCRIBED: 0, total: 1 });
    });

    it('confirms with the emailed token, once', async () => {
      const { token } = mail.confirmations[0];
      await http.post(`${api}/newsletter/confirm`).send({ token }).expect(204);
      await http.post(`${api}/newsletter/confirm`).send({ token }).expect(400);
      await http
        .post(`${api}/newsletter/confirm`)
        .send({ token: { $ne: null } })
        .expect(400);

      // Confirmed addresses get the same answer, and no email.
      await http.post(`${api}/newsletter/subscribe`).send({ email }).expect(202);
      expect(mail.confirmations).toHaveLength(1);

      const list = await http
        .get(`${api}/newsletter/subscribers?status=CONFIRMED`)
        .set(as('admin'))
        .expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({ email, status: 'CONFIRMED', source: 'footer' }),
      ]);
      expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    });

    it('sends a campaign once, to confirmed subscribers only', async () => {
      // A second confirmed subscriber whose emails bounce, and a pending one.
      await http.post(`${api}/newsletter/subscribe`).send({ email: 'bounce@example.com' }).expect(202);
      await http.post(`${api}/newsletter/subscribe`).send({ email: 'pending@example.com' }).expect(202);
      await new Promise((r) => setImmediate(r));
      const bounce = mail.confirmations.find((c) => c.to === 'bounce@example.com')!;
      await http.post(`${api}/newsletter/confirm`).send({ token: bounce.token }).expect(204);

      const created = await http
        .post(`${api}/newsletter/campaigns`)
        .set(as('admin'))
        .send({
          subject: 'Les astuces du mois',
          content: '<p onclick="x">Bonjour<script>alert(1)</script></p>',
        })
        .expect(201);
      expect(created.body).toMatchObject({ status: 'DRAFT', content: '<p>Bonjour</p>' });
      const id = created.body.id as string;

      const sending = await http
        .post(`${api}/newsletter/campaigns/${id}/send`)
        .set(as('admin'))
        .expect(202);
      expect(sending.body).toMatchObject({ status: 'SENDING', recipientCount: 2 });
      await http
        .post(`${api}/newsletter/campaigns/${id}/send`)
        .set(as('admin'))
        .expect(409);

      await app.get(CampaignsService).whenIdle();
      const done = await http
        .get(`${api}/newsletter/campaigns/${id}`)
        .set(as('admin'))
        .expect(200);
      expect(done.body).toMatchObject({ status: 'SENT', sentCount: 1, failedCount: 1 });
      expect(mail.campaigns.map((c) => c.to).sort()).toEqual([
        'bounce@example.com',
        'reader@example.com',
      ]);
      expect(mail.campaigns[0]).toMatchObject({
        subject: 'Les astuces du mois',
        html: '<p>Bonjour</p>',
        text: 'Bonjour',
      });
      expect(mail.campaigns[0].unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      await http
        .patch(`${api}/newsletter/campaigns/${id}`)
        .set(as('admin'))
        .send({ subject: 'Trop tard' })
        .expect(409);
    });

    it('unsubscribes in one click, idempotently', async () => {
      const { unsubscribeToken } = mail.campaigns.find((c) => c.to === email)!;
      await http
        .post(`${api}/newsletter/unsubscribe/one-click?token=${unsubscribeToken}`)
        .type('form')
        .send('List-Unsubscribe=One-Click')
        .expect(204);
      await http
        .post(`${api}/newsletter/unsubscribe`)
        .send({ token: unsubscribeToken })
        .expect(204);
      await http
        .post(`${api}/newsletter/unsubscribe`)
        .send({ token: 'x'.repeat(43) })
        .expect(400);

      const stats = await http
        .get(`${api}/newsletter/subscribers/stats`)
        .set(as('admin'))
        .expect(200);
      expect(stats.body).toEqual({ PENDING: 1, CONFIRMED: 1, UNSUBSCRIBED: 1, total: 3 });
    });
  });

  describe('analytics', () => {
    let videoId: string;
    let draftId: string;

    beforeAll(async () => {
      const videos = await http.get(`${api}/videos`).expect(200);
      videoId = videos.body.items[0].id as string;
      const draft = await http
        .post(`${api}/videos`)
        .set(as('admin'))
        .send({ title: 'Brouillon', url: 'https://vimeo.com/76979871' })
        .expect(201);
      draftId = draft.body.id as string;
    });

    const view = (id: string, ua: string | undefined, ip = '203.0.113.1') => {
      const req = http
        .post(`${api}/analytics/views`)
        .set('X-Forwarded-For', ip)
        .send({ type: 'VIDEO', id });
      return ua ? req.set('User-Agent', ua) : req.unset('User-Agent');
    };

    it('counts each visitor once a day, ignores bots, refuses private content', async () => {
      await view(videoId, BROWSER).expect(204);
      await view(videoId, BROWSER).expect(204); // same visitor
      await view(videoId, `${BROWSER} Edg/129.0`).expect(204); // another one
      await view(videoId, 'Googlebot/2.1').expect(204); // ignored
      await view(videoId, undefined).expect(204); // ignored
      await view(draftId, BROWSER).expect(404);
      await view(new Types.ObjectId().toHexString(), BROWSER).expect(404);

      const stats = await app
        .get<Model<DailyStat>>(getModelToken(DailyStat.name))
        .find()
        .lean()
        .exec();
      expect(stats).toEqual([
        expect.objectContaining({ targetType: 'VIDEO', views: 2 }),
      ]);
      // Nothing personal is stored.
      expect(Object.keys(stats[0]).sort()).toEqual(
        ['_id', 'day', 'target', 'targetType', 'views'].sort(),
      );
    });

    it('lists popular public content', async () => {
      const res = await http
        .get(`${api}/analytics/popular?type=VIDEO&days=7`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.body).toMatchObject({
        type: 'VIDEO',
        days: 7,
        items: [{ views: 2, item: { id: videoId, slug: 'desactiver-la-telemetrie' } }],
      });
    });

    it('gives admins an overview', async () => {
      const res = await http
        .get(`${api}/analytics/overview`)
        .set(as('admin'))
        .expect(200);
      expect(res.body.daily).toHaveLength(30);
      expect(res.body).toMatchObject({
        totals: { VIDEO: 2, ARTICLE: 0 },
        topVideos: [{ id: videoId, views: 2 }],
        topArticles: [],
        content: {
          videos: { DRAFT: 1, PUBLISHED: 1, ARCHIVED: 0 },
          articles: { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 },
        },
        newsletter: { CONFIRMED: 1, total: 3 },
      });
      await http
        .get(`${api}/analytics/overview?from=2024-01-01&to=2026-01-01`)
        .set(as('admin'))
        .expect(400);
      await http
        .get(`${api}/analytics/overview?from=2026-02-01&to=2026-01-01`)
        .set(as('admin'))
        .expect(400);
    });
  });
});
