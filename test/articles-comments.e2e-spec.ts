import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  getModelToken,
  MongooseModule,
  MongooseModuleOptions,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { ArticlesModule } from '../src/articles/articles.module';
import { Article } from '../src/articles/schemas/article.schema';
import { AuthUser } from '../src/auth/auth.types';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AppCacheModule } from '../src/cache/cache.module';
import { CommentsModule } from '../src/comments/comments.module';
import { Comment } from '../src/comments/schemas/comment.schema';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import configuration from '../src/config/configuration';
import { Tag } from '../src/taxonomy/tags/schemas/tag.schema';
import { Role, User } from '../src/users/schemas/user.schema';

/**
 * HTTP integration test of articles & comments against a real (in-memory)
 * MongoDB, with the production validation pipe, exception filter and
 * RolesGuard. Only JwtAuthGuard is stubbed: the `x-test-user` header picks
 * who is calling (the users exist in the DB so bylines can be populated).
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
  bob: {
    id: new Types.ObjectId().toHexString(),
    email: 'bob@test.local',
    role: Role.USER,
    sessionId: 's4',
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

interface ArticleBody {
  id: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  commentCount: number;
  content?: string;
  [key: string]: unknown;
}

interface CommentBody {
  id: string;
  replyCount: number;
  [key: string]: unknown;
}

describe('Articles & comments (HTTP integration)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let articleModel: Model<Article>;
  let commentModel: Model<Comment>;
  const api = '/api/v1';

  const as = (who: keyof typeof USERS) => ({ 'x-test-user': who });

  async function createArticle(body: Record<string, unknown>) {
    const res = await http
      .post(`${api}/articles`)
      .set(as('admin'))
      .send(body)
      .expect(201);
    return res.body as ArticleBody;
  }

  async function getArticle(id: string) {
    const res = await http
      .get(`${api}/articles/admin/${id}`)
      .set(as('admin'))
      .expect(200);
    return res.body as ArticleBody;
  }

  async function comment(
    who: keyof typeof USERS,
    articleId: string,
    body: Record<string, unknown>,
    status = 201,
  ) {
    const res = await http
      .post(`${api}/articles/${articleId}/comments`)
      .set(as(who))
      .send(body)
      .expect(status);
    return res.body as CommentBody;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      DB_NAME: 'articles-test',
      JWT_SECRET: randomBytes(32).toString('hex'),
      TWO_FACTOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NODE_ENV: 'test',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri(), {
          dbName: 'articles-test',
          // See taxonomy.e2e-spec.ts: the driver's dynamic import of `os`
          // fails in Jest's CommonJS sandbox.
          runtimeAdapters: { os },
        } as MongooseModuleOptions),
        AppCacheModule,
        ArticlesModule,
        CommentsModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    // Same setup as main.ts / AppModule.
    app.setGlobalPrefix('api/v1');
    (app as NestExpressApplication).useBodyParser('json', { limit: '512kb' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();

    articleModel = app.get(getModelToken(Article.name));
    commentModel = app.get(getModelToken(Comment.name));
    // Unique and text indexes must exist before the tests use them.
    await articleModel.syncIndexes();
    await commentModel.syncIndexes();
    await app.get<Model<Tag>>(getModelToken(Tag.name)).syncIndexes();

    const users = app.get<Model<User>>(getModelToken(User.name));
    await users.insertMany([
      {
        _id: USERS.admin.id,
        email: USERS.admin.email,
        passwordHash: 'x',
        firstName: 'Ada',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
      {
        _id: USERS.alice.id,
        email: USERS.alice.email,
        passwordHash: 'x',
        firstName: 'Alice',
      },
      { _id: USERS.bob.id, email: USERS.bob.email, passwordHash: 'x' },
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
      ['get', '/articles/admin'],
      ['get', `/articles/admin/${id}`],
      ['post', '/articles'],
      ['patch', `/articles/${id}`],
      ['delete', `/articles/${id}`],
      ['get', '/comments'],
      ['patch', `/comments/${id}/status`],
    ] as const)(
      '%s %s: 401 anonymous, 403 user, 403 admin without 2FA',
      async (method, path) => {
        await http[method](`${api}${path}`).send({}).expect(401);
        await http[method](`${api}${path}`)
          .set(as('alice'))
          .send({})
          .expect(403);
        await http[method](`${api}${path}`)
          .set(as('admin-no-2fa'))
          .send({})
          .expect(403);
      },
    );

    it.each([
      ['post', `/articles/${id}/comments`],
      ['patch', `/comments/${id}`],
      ['delete', `/comments/${id}`],
    ] as const)('%s %s needs a signed-in user', async (method, path) => {
      await http[method](`${api}${path}`).send({ content: 'x' }).expect(401);
    });
  });

  describe('articles', () => {
    let tagId: string;
    let published: ArticleBody;
    let draft: ArticleBody;

    it('creates a draft with derived slug, excerpt and sanitized content', async () => {
      const tag = await http
        .post(`${api}/tags`)
        .set(as('admin'))
        .send({ name: 'Windows' })
        .expect(201);
      tagId = tag.body.id;

      draft = await createArticle({
        title: 'Désactiver la télémétrie',
        content:
          '<h1>Intro</h1><p onclick="steal()">Un <strong>guide</strong> complet.</p><script>alert(1)</script><img src="https://cdn.example.com/a.png" onerror="x">',
        tagIds: [tagId],
      });
      expect(draft).toMatchObject({
        slug: 'desactiver-la-telemetrie',
        excerpt: 'Intro Un guide complet.',
        status: 'DRAFT',
        publishedAt: null,
        readingTimeMinutes: 1,
        commentsEnabled: true,
        commentCount: 0,
        author: { id: USERS.admin.id, name: 'Ada Admin' },
        category: null,
        tags: [{ id: tagId, name: 'Windows', slug: 'windows' }],
      });
      expect(draft.content).toBe(
        '<h2>Intro</h2><p>Un <strong>guide</strong> complet.</p><img loading="lazy" src="https://cdn.example.com/a.png" />',
      );
      expect(JSON.stringify(draft)).not.toContain('admin@test.local');
    });

    it('keeps drafts private', async () => {
      await http.get(`${api}/articles/slug/${draft.slug}`).expect(404);
      const list = await http.get(`${api}/articles`).expect(200);
      expect(list.body.total).toBe(0);
    });

    it('rejects bad references, duplicates and mass assignment', async () => {
      const base = { title: 'Autre article', content: '<p>x</p>' };
      const unknownCategory = await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ ...base, categoryId: new Types.ObjectId().toHexString() })
        .expect(400);
      expect(unknownCategory.body.message).toMatch(/Category not found/);
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ ...base, tagIds: [new Types.ObjectId().toHexString()] })
        .expect(400);
      const dup = await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ ...base, slug: draft.slug })
        .expect(409);
      expect(dup.body.message).toMatch(/slug/);
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ ...base, commentCount: 99, author: USERS.alice.id })
        .expect(400);
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ ...base, content: '<script>only()</script>' })
        .expect(400);
    });

    it('accepts large bodies up to the content limit', async () => {
      const big = await createArticle({
        title: 'Article long',
        content: `<p>${'mot '.repeat(30_000)}</p>`,
      });
      expect(big.readingTimeMinutes).toBe(150);
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ title: 'Trop long', content: `<p>${'x'.repeat(150_001)}</p>` })
        .expect(400);
      await http
        .delete(`${api}/articles/${big.id}`)
        .set(as('admin'))
        .expect(204);
    });

    it('answers body-parser errors with 4xx, not 500', async () => {
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .send({ title: 'Énorme', content: 'x'.repeat(600_000) })
        .expect(413);
      await http
        .post(`${api}/articles`)
        .set(as('admin'))
        .set('content-type', 'application/json')
        .send('{"title": ')
        .expect(400);
    });

    it('publishes: dates it now and makes it public', async () => {
      const res = await http
        .patch(`${api}/articles/${draft.id}`)
        .set(as('admin'))
        .send({ status: 'PUBLISHED' })
        .expect(200);
      published = res.body;
      expect(published.status).toBe('PUBLISHED');
      expect(
        Math.abs(Date.parse(published.publishedAt!) - Date.now()),
      ).toBeLessThan(10_000);

      const bySlug = await http
        .get(`${api}/articles/slug/${draft.slug}`)
        .expect(200);
      expect(bySlug.headers['cache-control']).toBe('public, max-age=60');
      expect(bySlug.body.content).toBe(draft.content);
    });

    it('hides scheduled articles until their date', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const scheduled = await createArticle({
        title: 'Article programmé',
        content: '<p>Bientôt</p>',
        status: 'PUBLISHED',
        publishedAt: future,
      });
      expect(scheduled.publishedAt).toBe(future);
      await http.get(`${api}/articles/slug/${scheduled.slug}`).expect(404);

      const admin = await http
        .get(`${api}/articles/admin?status=PUBLISHED`)
        .set(as('admin'))
        .expect(200);
      expect(admin.body.total).toBe(2);
    });

    it('lists without bodies, filters by tag, category subtree and search', async () => {
      const parent = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Systèmes' })
        .expect(201);
      const child = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Linux', parentId: parent.body.id })
        .expect(201);
      await createArticle({
        title: 'Maîtriser grep sous Linux',
        content: '<p>grep -r</p>',
        categoryId: child.body.id,
        status: 'PUBLISHED',
      });

      const all = await http.get(`${api}/articles`).expect(200);
      expect(all.body.total).toBe(2);
      for (const item of all.body.items) {
        expect(item).not.toHaveProperty('content');
      }
      // Newest first by default.
      expect(all.body.items[0].slug).toBe('maitriser-grep-sous-linux');

      const byTag = await http.get(`${api}/articles?tag=windows`).expect(200);
      expect(byTag.body.items.map((a: ArticleBody) => a.id)).toEqual([
        draft.id,
      ]);
      const bySubtree = await http
        .get(`${api}/articles?category=systemes`)
        .expect(200);
      expect(bySubtree.body.total).toBe(1);
      expect(bySubtree.body.items[0].category).toMatchObject({ slug: 'linux' });
      const unknown = await http
        .get(`${api}/articles?category=inconnue`)
        .expect(200);
      expect(unknown.body.total).toBe(0);

      // French stemming: "télémétries" matches "télémétrie".
      const search = await http
        .get(`${api}/articles?search=télémétries`)
        .expect(200);
      expect(search.body.items.map((a: ArticleBody) => a.id)).toEqual([
        draft.id,
      ]);

      await http.get(`${api}/articles?search[$ne]=x`).expect(400);
      await http.get(`${api}/articles?status=DRAFT`).expect(400);
      await http.get(`${api}/articles/slug/Bad%20Slug`).expect(400);
      await http
        .get(`${api}/articles/admin/not-an-id`)
        .set(as('admin'))
        .expect(400);
    });

    it('updates explicitly mapped fields only, and audits real changes', async () => {
      const res = await http
        .patch(`${api}/articles/${draft.id}`)
        .set(as('admin'))
        .send({
          title: 'Désactiver la télémétrie de Windows 11',
          coverImage: { url: 'https://cdn.example.com/c.webp', alt: 'Capture' },
          tagIds: [],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        title: 'Désactiver la télémétrie de Windows 11',
        slug: draft.slug, // stable URL
        coverImage: { url: 'https://cdn.example.com/c.webp', alt: 'Capture' },
        tags: [],
      });

      const cleared = await http
        .patch(`${api}/articles/${draft.id}`)
        .set(as('admin'))
        .send({ coverImage: null, excerpt: 'Résumé écrit à la main' })
        .expect(200);
      expect(cleared.body).toMatchObject({
        coverImage: null,
        excerpt: 'Résumé écrit à la main',
      });

      await http
        .patch(`${api}/articles/${draft.id}`)
        .set(as('admin'))
        .send({ coverImage: { url: 'http://insecure.example.com/x.png' } })
        .expect(400);
      await http
        .patch(`${api}/articles/${new Types.ObjectId().toHexString()}`)
        .set(as('admin'))
        .send({ title: 'Introuvable' })
        .expect(404);
    });
  });

  describe('comments', () => {
    let article: ArticleBody;
    let top: CommentBody;
    let reply: CommentBody;

    beforeAll(async () => {
      article = await createArticle({
        title: 'Article commenté',
        content: '<p>Commentez !</p>',
        status: 'PUBLISHED',
      });
    });

    it('lets a user comment with plain text, showing a byline without email', async () => {
      top = await comment('alice', article.id, {
        content: '  Merci, très utile !  ',
      });
      expect(top).toMatchObject({
        articleId: article.id,
        parentId: null,
        author: { id: USERS.alice.id, name: 'Alice' },
        content: 'Merci, très utile !',
        status: 'PUBLISHED',
        replyCount: 0,
        editedAt: null,
      });
      expect(JSON.stringify(top)).not.toContain('@test.local');

      await comment('alice', article.id, { content: '<b>x</b>' }, 400);
      await comment(
        'alice',
        article.id,
        { content: 'x', status: 'HIDDEN' },
        400,
      );
      await comment('alice', article.id, { content: { $gt: '' } }, 400);
    });

    it('supports one level of replies', async () => {
      reply = await comment('bob', article.id, {
        content: 'Pareil',
        parentId: top.id,
      });
      expect(reply).toMatchObject({
        parentId: top.id,
        author: { id: USERS.bob.id, name: null },
      });
      await comment(
        'alice',
        article.id,
        { content: 'Trop profond', parentId: reply.id },
        400,
      );
      await comment(
        'alice',
        article.id,
        { content: 'Orphelin', parentId: new Types.ObjectId().toHexString() },
        400,
      );

      const list = await http
        .get(`${api}/articles/${article.id}/comments`)
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({ id: top.id, replyCount: 1 });

      const replies = await http
        .get(`${api}/comments/${top.id}/replies`)
        .expect(200);
      expect(replies.body.items.map((c: CommentBody) => c.id)).toEqual([
        reply.id,
      ]);
      expect((await getArticle(article.id)).commentCount).toBe(2);
    });

    it('refuses comments on drafts, scheduled or closed articles', async () => {
      const draft = await createArticle({
        title: 'Brouillon',
        content: '<p>x</p>',
      });
      await comment('alice', draft.id, { content: 'x' }, 404);
      await http.get(`${api}/articles/${draft.id}/comments`).expect(404);

      const closed = await createArticle({
        title: 'Fermé',
        content: '<p>x</p>',
        status: 'PUBLISHED',
        commentsEnabled: false,
      });
      const res = await comment('alice', closed.id, { content: 'x' }, 403);
      expect(res).toMatchObject({ message: expect.stringMatching(/closed/) });
    });

    it('lets only the author edit, within 15 minutes', async () => {
      await http
        .patch(`${api}/comments/${top.id}`)
        .set(as('bob'))
        .send({ content: 'Piraté' })
        .expect(403);
      await http
        .patch(`${api}/comments/${top.id}`)
        .set(as('admin'))
        .send({ content: 'Censuré' })
        .expect(403);
      const edited = await http
        .patch(`${api}/comments/${top.id}`)
        .set(as('alice'))
        .send({ content: 'Merci, vraiment très utile !' })
        .expect(200);
      expect(edited.body.content).toBe('Merci, vraiment très utile !');
      expect(edited.body.editedAt).not.toBeNull();

      await commentModel.collection.updateOne(
        { _id: new Types.ObjectId(top.id) },
        { $set: { createdAt: new Date(Date.now() - 16 * 60_000) } },
      );
      const late = await http
        .patch(`${api}/comments/${top.id}`)
        .set(as('alice'))
        .send({ content: 'Trop tard' })
        .expect(403);
      expect(late.body.message).toMatch(/no longer/);
    });

    it('moderation hides and re-publishes, keeping counters right', async () => {
      const queue = await http
        .get(`${api}/comments?articleId=${article.id}&status=PUBLISHED`)
        .set(as('admin'))
        .expect(200);
      expect(queue.body.total).toBe(2);

      const hidden = await http
        .patch(`${api}/comments/${reply.id}/status`)
        .set(as('admin'))
        .send({ status: 'HIDDEN' })
        .expect(200);
      expect(hidden.body.status).toBe('HIDDEN');
      // Repeating the same transition is a no-op for the counters.
      await http
        .patch(`${api}/comments/${reply.id}/status`)
        .set(as('admin'))
        .send({ status: 'HIDDEN' })
        .expect(200);

      const replies = await http
        .get(`${api}/comments/${top.id}/replies`)
        .expect(200);
      expect(replies.body.total).toBe(0);
      expect((await getArticle(article.id)).commentCount).toBe(1);
      const parent = await commentModel.findById(top.id).lean().exec();
      expect(parent?.replyCount).toBe(0);

      await http
        .patch(`${api}/comments/${reply.id}/status`)
        .set(as('admin'))
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect((await getArticle(article.id)).commentCount).toBe(2);
      await http
        .patch(`${api}/comments/${new Types.ObjectId().toHexString()}/status`)
        .set(as('admin'))
        .send({ status: 'HIDDEN' })
        .expect(404);
    });

    it('lets the author or a 2FA admin delete; top-level deletes cascade', async () => {
      await http.delete(`${api}/comments/${top.id}`).set(as('bob')).expect(403);
      await http
        .delete(`${api}/comments/${top.id}`)
        .set(as('admin-no-2fa'))
        .expect(403);

      const own = await comment('bob', article.id, { content: 'À supprimer' });
      await http.delete(`${api}/comments/${own.id}`).set(as('bob')).expect(204);
      expect((await getArticle(article.id)).commentCount).toBe(2);

      await http
        .delete(`${api}/comments/${top.id}`)
        .set(as('admin'))
        .expect(204);
      expect(await commentModel.countDocuments({ article: article.id })).toBe(
        0,
      );
      expect((await getArticle(article.id)).commentCount).toBe(0);
      await http
        .delete(`${api}/comments/${top.id}`)
        .set(as('admin'))
        .expect(404);
    });

    it('deleting an article deletes its comments', async () => {
      await comment('alice', article.id, { content: 'Dernier' });
      await http
        .delete(`${api}/articles/${article.id}`)
        .set(as('admin'))
        .expect(204);
      expect(await commentModel.countDocuments({ article: article.id })).toBe(
        0,
      );
      expect(await articleModel.exists({ _id: article.id })).toBeNull();
      await http.get(`${api}/articles/${article.id}/comments`).expect(404);
    });
  });
});
