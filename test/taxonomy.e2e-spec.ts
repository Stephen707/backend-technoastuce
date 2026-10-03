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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthUser } from '../src/auth/auth.types';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import configuration from '../src/config/configuration';
import { Category } from '../src/taxonomy/categories/schemas/category.schema';
import { Tag } from '../src/taxonomy/tags/schemas/tag.schema';
import { TaxonomyModule } from '../src/taxonomy/taxonomy.module';
import { Role } from '../src/users/schemas/user.schema';

/**
 * HTTP integration test of categories & tags against a real (in-memory)
 * MongoDB, with the production validation pipe, exception filter and
 * RolesGuard. Only JwtAuthGuard is stubbed (it is covered with the auth
 * module): the `x-test-user` header picks who is calling.
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
  user: {
    id: new Types.ObjectId().toHexString(),
    email: 'user@test.local',
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

describe('Taxonomy (HTTP integration)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const api = '/api/v1';

  const as = (who: keyof typeof USERS) => ({ 'x-test-user': who });

  async function createCategory(body: Record<string, unknown>) {
    const res = await http
      .post(`${api}/categories`)
      .set(as('admin'))
      .send(body)
      .expect(201);
    return res.body as { id: string; slug: string; depth: number };
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      DB_NAME: 'taxonomy-test',
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
          dbName: 'taxonomy-test',
          // The driver loads `os` with a dynamic import(), which Jest's
          // CommonJS sandbox rejects (the handshake then fails): inject it.
          runtimeAdapters: { os },
        } as MongooseModuleOptions),
        TaxonomyModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
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

    // Unique indexes must exist before testing duplicates.
    await app.get<Model<Category>>(getModelToken(Category.name)).syncIndexes();
    await app.get<Model<Tag>>(getModelToken(Tag.name)).syncIndexes();

    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('access control', () => {
    it.each([
      ['post', '/categories'],
      ['patch', `/categories/${new Types.ObjectId().toHexString()}`],
      ['delete', `/categories/${new Types.ObjectId().toHexString()}`],
      ['post', '/tags'],
      ['patch', `/tags/${new Types.ObjectId().toHexString()}`],
      ['delete', `/tags/${new Types.ObjectId().toHexString()}`],
    ] as const)(
      '%s %s: 401 anonymous, 403 user, 403 admin without 2FA',
      async (method, path) => {
        await http[method](`${api}${path}`).send({ name: 'X' }).expect(401);
        await http[method](`${api}${path}`)
          .set(as('user'))
          .send({ name: 'X' })
          .expect(403);
        await http[method](`${api}${path}`)
          .set(as('admin-no-2fa'))
          .send({ name: 'X' })
          .expect(403);
      },
    );

    it('reads are public', async () => {
      await http.get(`${api}/categories`).expect(200);
      await http.get(`${api}/categories/tree`).expect(200);
      await http.get(`${api}/tags`).expect(200);
    });

    it('documents the routes in OpenAPI, with bearer auth on writes only', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      const categories = doc.paths['/api/v1/categories'];
      expect(categories.get?.security).toBeUndefined();
      expect(categories.post?.security).toEqual([{ 'access-token': [] }]);
      expect(doc.paths['/api/v1/categories/tree']).toBeDefined();
      expect(doc.paths['/api/v1/tags/{id}'].delete).toBeDefined();
    });
  });

  describe('categories', () => {
    let windows: { id: string };
    let tips: { id: string };
    let registry: { id: string };

    it('creates a root category with a derived slug', async () => {
      const res = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Windows', description: 'Tout sur Windows' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Windows',
        slug: 'windows',
        description: 'Tout sur Windows',
        parentId: null,
        depth: 1,
        position: 0,
      });
      expect(res.body).not.toHaveProperty('ancestors');
      expect(res.body).not.toHaveProperty('_id');
      windows = res.body;
    });

    it('rejects duplicate slugs and case-insensitive sibling names', async () => {
      const dupSlug = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Win', slug: 'windows' })
        .expect(409);
      expect(dupSlug.body.message).toMatch(/slug/);

      const dupName = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'WINDOWS', slug: 'windows-2' })
        .expect(409);
      expect(dupName.body.message).toMatch(/name/);
    });

    it('rejects unknown fields, markup and operator injection', async () => {
      await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Linux', ancestors: [new Types.ObjectId()] })
        .expect(400);
      await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: '<img src=x onerror=alert(1)>' })
        .expect(400);
      await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: { $gt: '' } })
        .expect(400);
      await http.get(`${api}/categories?search[$ne]=x`).expect(400);
      await http.get(`${api}/categories?parent[$ne]=x`).expect(400);
    });

    it('nests up to 3 levels', async () => {
      tips = await createCategory({ name: 'Astuces', parentId: windows.id });
      registry = await createCategory({
        name: 'Registre',
        parentId: (tips as { id: string }).id,
      });
      expect(registry).toMatchObject({ depth: 3 });

      const tooDeep = await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Clés', parentId: registry.id })
        .expect(400);
      expect(tooDeep.body.message).toMatch(/3 levels/);

      await http
        .post(`${api}/categories`)
        .set(as('admin'))
        .send({ name: 'Ghost', parentId: new Types.ObjectId().toHexString() })
        .expect(400);
    });

    it('allows the same name under different parents', async () => {
      const linux = await createCategory({ name: 'Linux' });
      await createCategory({
        name: 'Astuces',
        slug: 'linux-astuces',
        parentId: linux.id,
      });
    });

    it('returns a category by slug and id with its breadcrumb', async () => {
      const bySlug = await http
        .get(`${api}/categories/slug/registre`)
        .expect(200);
      expect(bySlug.body.path.map((c: { slug: string }) => c.slug)).toEqual([
        'windows',
        'astuces',
      ]);
      const byId = await http
        .get(`${api}/categories/${registry.id}`)
        .expect(200);
      expect(byId.body).toEqual(bySlug.body);

      await http.get(`${api}/categories/slug/nope`).expect(404);
      await http.get(`${api}/categories/slug/Bad%20Slug`).expect(400);
      await http.get(`${api}/categories/not-an-id`).expect(400);
    });

    it('lists with pagination and filters', async () => {
      const roots = await http
        .get(`${api}/categories?parent=root&sort=name`)
        .expect(200);
      expect(roots.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Linux',
        'Windows',
      ]);

      const children = await http
        .get(`${api}/categories?parent=${windows.id}`)
        .expect(200);
      expect(children.body.total).toBe(1);

      const page = await http
        .get(`${api}/categories?limit=2&page=2&sort=createdAt`)
        .expect(200);
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: 5 });
      expect(page.body.totalPages).toBe(3);
      expect(page.body.items).toHaveLength(2);

      const search = await http.get(`${api}/categories?search=ast`).expect(200);
      expect(search.body.total).toBe(2);

      await http.get(`${api}/categories?limit=101`).expect(400);
    });

    it('serves the nested tree and refreshes it after writes', async () => {
      const before = await http.get(`${api}/categories/tree`).expect(200);
      expect(before.headers['cache-control']).toBe('public, max-age=60');
      const win = before.body.find(
        (n: { slug: string }) => n.slug === 'windows',
      );
      expect(win.children[0].children[0].slug).toBe('registre');

      await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ position: 5 })
        .expect(200);
      const after = await http.get(`${api}/categories/tree`).expect(200);
      expect(after.body.map((n: { slug: string }) => n.slug)).toEqual([
        'linux',
        'windows',
      ]);
    });

    it('rejects self-parenting, cycles and too-deep moves', async () => {
      await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ parentId: windows.id })
        .expect(400);

      const cycle = await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ parentId: registry.id })
        .expect(400);
      expect(cycle.body.message).toMatch(/own subcategories/);

      // Windows > Astuces > Registre has 3 levels: it can't go under anything.
      const mac = await createCategory({ name: 'Mac' });
      const deep = await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ parentId: mac.id })
        .expect(400);
      expect(deep.body.message).toMatch(/3 levels/);
    });

    it('moves a subtree and rebases its descendants', async () => {
      const mac = (await http.get(`${api}/categories/slug/mac`).expect(200))
        .body as { id: string };
      const moved = await http
        .patch(`${api}/categories/${tips.id}`)
        .set(as('admin'))
        .send({ parentId: mac.id })
        .expect(200);
      expect(moved.body).toMatchObject({ parentId: mac.id, depth: 2 });

      const reg = await http.get(`${api}/categories/slug/registre`).expect(200);
      expect(reg.body).toMatchObject({ depth: 3 });
      expect(reg.body.path.map((c: { slug: string }) => c.slug)).toEqual([
        'mac',
        'astuces',
      ]);

      // Back to the root: the subtree follows.
      await http
        .patch(`${api}/categories/${tips.id}`)
        .set(as('admin'))
        .send({ parentId: null })
        .expect(200);
      const regRoot = await http
        .get(`${api}/categories/slug/registre`)
        .expect(200);
      expect(regRoot.body).toMatchObject({ depth: 2, parentId: tips.id });
      expect(regRoot.body.path).toHaveLength(1);
    });

    it('updates fields, clears the description, and keeps the slug on rename', async () => {
      const res = await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ name: 'Microsoft Windows', description: '' })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Microsoft Windows',
        slug: 'windows',
      });
      expect(res.body).not.toHaveProperty('description');

      await http
        .patch(`${api}/categories/${windows.id}`)
        .set(as('admin'))
        .send({ name: null })
        .expect(400);
      await http
        .patch(`${api}/categories/${new Types.ObjectId().toHexString()}`)
        .set(as('admin'))
        .send({ name: 'Nope' })
        .expect(404);
    });

    it('refuses to delete a category that has subcategories', async () => {
      await http
        .delete(`${api}/categories/${tips.id}`)
        .set(as('admin'))
        .expect(409);
      await http
        .delete(`${api}/categories/${registry.id}`)
        .set(as('admin'))
        .expect(204);
      await http
        .delete(`${api}/categories/${tips.id}`)
        .set(as('admin'))
        .expect(204);
      await http.get(`${api}/categories/${tips.id}`).expect(404);
      await http
        .delete(`${api}/categories/${tips.id}`)
        .set(as('admin'))
        .expect(404);
    });
  });

  describe('tags', () => {
    let tag: { id: string; slug: string };

    it('creates tags with derived slugs', async () => {
      for (const name of ['PowerShell', 'bash', 'C++', 'C#']) {
        await http
          .post(`${api}/tags`)
          .set(as('admin'))
          .send({ name })
          .expect(201);
      }
      const res = await http.get(`${api}/tags/slug/c-plus-plus`).expect(200);
      expect(res.body).toMatchObject({ name: 'C++' });
      expect(Object.keys(res.body).sort()).toEqual(
        ['createdAt', 'id', 'name', 'slug', 'updatedAt'].sort(),
      );
      tag = res.body;
    });

    it('rejects case-insensitive duplicate names and duplicate slugs', async () => {
      const byName = await http
        .post(`${api}/tags`)
        .set(as('admin'))
        .send({ name: 'powershell', slug: 'ps' })
        .expect(409);
      expect(byName.body.message).toMatch(/name/);
      await http
        .post(`${api}/tags`)
        .set(as('admin'))
        .send({ name: 'Bash shell', slug: 'bash' })
        .expect(409);
    });

    it('lists case-insensitively by name, with search and pagination', async () => {
      const all = await http.get(`${api}/tags`).expect(200);
      expect(all.body.items.map((t: { name: string }) => t.name)).toEqual([
        'bash',
        'C#',
        'C++',
        'PowerShell',
      ]);
      const search = await http.get(`${api}/tags?search=c%2B`).expect(200);
      expect(search.body.items.map((t: { name: string }) => t.name)).toEqual([
        'C++',
      ]);
      const page = await http.get(`${api}/tags?limit=3&page=2`).expect(200);
      expect(page.body).toMatchObject({ total: 4, totalPages: 2 });
      expect(page.body.items).toHaveLength(1);
    });

    it('updates and deletes a tag', async () => {
      const res = await http
        .patch(`${api}/tags/${tag.id}`)
        .set(as('admin'))
        .send({ slug: 'cpp' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'C++', slug: 'cpp' });
      await http
        .patch(`${api}/tags/${tag.id}`)
        .set(as('admin'))
        .send({ slug: 'bash' })
        .expect(409);
      await http
        .patch(`${api}/tags/${tag.id}`)
        .set(as('admin'))
        .send({ color: 'red' })
        .expect(400);

      await http.delete(`${api}/tags/${tag.id}`).set(as('admin')).expect(204);
      await http.get(`${api}/tags/${tag.id}`).expect(404);
    });
  });
});
