<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

> NestJS 12 ships ESM only. On Node < 24.9 Jest can't load it directly, so
> `test/esm-to-cjs.transformer.cjs` compiles `@nestjs/*` to CommonJS for
> tests only (see `jest.config.ts`). The same applies to `htmlparser2` and
> its `dom*`/`entities` dependencies, used by `sanitize-html`.

`npm run test:e2e` runs the HTTP integration tests (`test/*.e2e-spec.ts`)
against an in-memory MongoDB (`mongodb-memory-server`, which downloads a
`mongod` binary on first run). They use the real validation pipe, exception
filter and `RolesGuard`; only `JwtAuthGuard` is stubbed.

## Users API

All routes are under `/api/v1/users` and require a Bearer access token.

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /users/me` | any user | Own profile |
| `PATCH /users/me` | any user | `firstName`, `lastName` only |
| `POST /users/me/password` | any user | `currentPassword` + `newPassword`; signs out other sessions; 5 req/min |
| `GET /users` | ADMIN, SUPER_ADMIN | `page`, `limit` (≤ 100), `search` (prefix on email/names), `role`, `isActive`, `sort` |
| `GET /users/:id` | ADMIN, SUPER_ADMIN | |
| `PATCH /users/:id` | ADMIN, SUPER_ADMIN | `firstName`, `lastName`, `role`, `isActive` |
| `POST /users/:id/unlock` | ADMIN, SUPER_ADMIN | Clears a brute-force lockout |

Rules:

- Admin routes also require a session that passed TOTP (see `RolesGuard`).
- An ADMIN only manages USER accounts and can't grant ADMIN/SUPER_ADMIN.
  A SUPER_ADMIN manages every account except their own. Nobody can use admin
  routes on themselves, so the last SUPER_ADMIN can't be demoted.
- A role change or deactivation revokes every session of the target user.
- Unknown body/query fields are rejected (400), and names are restricted to
  letters, spaces, `'`, `.` and `-`.
- Admin actions are logged by the `Audit` logger (`actor`, `target` and the
  changed fields; names stay out of logs).

`UsersModule` is the data layer (schema + `UsersService`) used by
`AuthModule`; the HTTP routes live in `UserManagementModule`, which imports
`AuthModule` for its guards. This avoids a circular module import.

## Categories & Tags API

Routes under `/api/v1/categories` and `/api/v1/tags` (`src/taxonomy/`).
Reads are public; writes require ADMIN or SUPER_ADMIN with a 2FA-verified
session (`@AdminOnly()`).

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /categories` | public | `page`, `limit` (≤ 100), `search` (name prefix), `parent` (id or `root`), `sort` |
| `GET /categories/tree` | public | Whole nested tree in one query; cached 60 s (in memory + `Cache-Control`), ≤ 1000 nodes |
| `GET /categories/slug/:slug` | public | With `path` (breadcrumb, root first) |
| `GET /categories/:id` | public | Same shape as by slug |
| `POST /categories` | ADMIN, SUPER_ADMIN | `name`, `slug?`, `description?`, `parentId?`, `position?` |
| `PATCH /categories/:id` | ADMIN, SUPER_ADMIN | Same fields; `parentId: null` moves to the root, `description: ""` clears it |
| `DELETE /categories/:id` | ADMIN, SUPER_ADMIN | 409 while it has subcategories |
| `GET /tags` | public | `page`, `limit` (≤ 100), `search` (name prefix), `sort` (case-insensitive by name by default) |
| `GET /tags/slug/:slug`, `GET /tags/:id` | public | |
| `POST /tags`, `PATCH /tags/:id` | ADMIN, SUPER_ADMIN | `name`, `slug?` |
| `DELETE /tags/:id` | ADMIN, SUPER_ADMIN | |

Rules:

- Categories nest at most 3 levels. Each stores `ancestors` (materialized
  path), so breadcrumbs, cycle and depth checks are single indexed reads.
  Moving a category carries its whole subtree; moving it under itself or one
  of its descendants, or deeper than 3 levels, is rejected (400).
- Slugs are unique (`a-z`, `0-9`, single hyphens, ≤ 80 chars). When omitted
  they are derived from the name (`"C++"` → `c-plus-plus`,
  `"Réseaux"` → `reseaux`) and are not changed by a later rename, so URLs
  stay stable. Tag names are unique case-insensitively; category names are
  unique case-insensitively among siblings. Conflicts return 409.
- Names allow letters, digits, spaces and `. # + & ' / ( ) , : -`.
  Descriptions are plain text (≤ 500 chars, no `<`/`>` or control chars);
  clients must still escape them when rendering.
- Unknown body/query fields are rejected (400) and each field is mapped
  explicitly into updates (no mass assignment); search terms are
  regex-escaped.
- Writes are logged by the `Audit` logger (`category.created`,
  `tag.updated`, ... with actor, id, slug and changed field names).
- Known limit: a move updates the category then its descendants in two
  writes (no transaction), so two simultaneous moves of related categories
  could leave the tree inconsistent. Category administration is expected to
  be low-traffic.

## Articles API

Routes under `/api/v1/articles` (`src/articles/`). Public reads only see
articles with `status: PUBLISHED` and a `publishedAt` in the past; every
admin route and write requires ADMIN or SUPER_ADMIN with a 2FA-verified
session (`@AdminOnly()`).

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /articles` | public | `page`, `limit` (≤ 100), `search` (full text, French stemming), `category` (slug, includes subcategories), `tag` (slug), `sort` (`-publishedAt` default, `publishedAt`). No `content` in items. `Cache-Control: public, max-age=60` |
| `GET /articles/slug/:slug` | public | Full article with `content`; same cache header |
| `GET /articles/admin` | ADMIN, SUPER_ADMIN | Any status; `status`, `categoryId`, `tagId`, `search`, `sort` |
| `GET /articles/admin/:id` | ADMIN, SUPER_ADMIN | Drafts included |
| `POST /articles` | ADMIN, SUPER_ADMIN | `title`, `content`, `slug?`, `excerpt?`, `coverImage? {url, alt?}`, `categoryId?`, `tagIds?` (≤ 10), `status?` (`DRAFT` default), `publishedAt?`, `commentsEnabled?` |
| `PATCH /articles/:id` | ADMIN, SUPER_ADMIN | Same fields; `coverImage`/`categoryId`/`publishedAt: null` clear them, `tagIds: []` removes tags, `excerpt: ""` derives it again |
| `DELETE /articles/:id` | ADMIN, SUPER_ADMIN | Also deletes its comments |

Rules:

- `content` is HTML from the editor, **sanitized on input** with
  `sanitize-html` against an allowlist: `h2`–`h4` (`h1` becomes `h2`),
  paragraphs, emphasis, lists, quotes, links (`http(s)`/`mailto`; only
  `target="_blank"` is kept, always with `rel="noopener noreferrer"`),
  `code`/`pre` (only `language-*` classes), `https` images (numeric
  `width`/`height`, `loading="lazy"` added) and tables. Scripts, styles,
  event handlers, inline styles, iframes, forms, `javascript:`/`data:` and
  protocol-relative URLs are removed. Content that is empty once sanitized
  is rejected. Limit: 150,000 characters after sanitization; the global JSON
  body limit is raised to 512 kB for this (`JSON_BODY_LIMIT` in `main.ts`).
- `title` and cover `alt` are single-line plain text (no `<`/`>`, no control
  chars); `excerpt` is plain text (≤ 300). When omitted, the excerpt is
  derived from the content (≤ 200 chars, cut at a word), and
  `readingTimeMinutes` is always computed (200 words/min).
- `coverImage.url` must be an absolute `https` URL with a public host and no
  credentials.
- Publishing sets `publishedAt` to now unless a date is given; a future date
  schedules the article (hidden from public routes until then). Slugs follow
  the taxonomy rules and are not changed by a title change.
- Category and tag ids must exist (400 otherwise). A tag or category
  deleted later simply disappears from the article's view.
- Author, category and tags are resolved with one batched query per path
  (no N+1); bylines only expose `{ id, name }`, never the email.
- Writes are logged by the `Audit` logger (`article.created`,
  `article.updated` with the changed field names, `article.deleted` with the
  number of comments removed).

## Comments API

Routes in `src/comments/`. Comments are plain text (≤ 2000 chars, no
`<`/`>` or control chars; clients must still escape them) with one level of
replies.

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /articles/:articleId/comments` | public | Top-level comments of a public article; `page`, `limit` (≤ 50), `sort` (`-createdAt` default, `createdAt`) |
| `POST /articles/:articleId/comments` | signed-in user | `content`, `parentId?` (a top-level comment of the same article); 5 req/min |
| `GET /comments/:id/replies` | public | Replies, oldest first; `page`, `limit` (≤ 50) |
| `PATCH /comments/:id` | author | `content`; only within 15 minutes of posting; 5 req/min |
| `DELETE /comments/:id` | author, or ADMIN/SUPER_ADMIN with 2FA | Deleting a top-level comment deletes its replies |
| `GET /comments` | ADMIN, SUPER_ADMIN | Moderation queue; `status`, `articleId`, `page`, `limit`, `sort` |
| `PATCH /comments/:id/status` | ADMIN, SUPER_ADMIN | `status`: `PUBLISHED` or `HIDDEN` |

Rules:

- Only published, already-due articles accept or show comments (404
  otherwise); `commentsEnabled: false` closes them (403).
- Comments are published immediately; moderators hide them afterwards.
  Hidden comments disappear from public routes.
- `article.commentCount` and `comment.replyCount` count published comments
  and are updated atomically on create, moderation and delete (never below
  zero). Repeating a moderation with the same status changes nothing.
  Hiding a top-level comment hides its thread from the public but its
  published replies still count in `commentCount`.
- Moderator actions are logged by the `Audit` logger (`comment.moderated`,
  `comment.deleted`).
- Known limit: like category moves, multi-document updates (create + counter,
  cascade deletes) are not transactional; a crash in between can leave a
  counter off by one.

## Videos API

Routes under `/api/v1/videos` (`src/videos/`), same layout and rules as
articles: public reads of published videos (`Cache-Control: public,
max-age=60`), `/admin` reads and every write admin-only and audited.

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /videos` | public | `page`, `limit`, `search` (full text), `category` (slug + subtree), `tag`, `sort` |
| `GET /videos/slug/:slug` | public | With `description` |
| `GET /videos/admin`, `GET /videos/admin/:id` | admin | `status`, `provider`, `search`, `sort` |
| `POST /videos` | admin | `title`, `url`, `slug?`, `description?`, `thumbnailUrl?`, `durationSeconds?`, `categoryId?`, `tagIds?`, `status?`, `publishedAt?` |
| `PATCH /videos/:id`, `DELETE /videos/:id` | admin | `null` clears `thumbnailUrl`, `durationSeconds`, `categoryId`, `publishedAt` |

- `url` must be a YouTube (`watch`, `youtu.be`, `shorts`, `embed`, `live`)
  or Vimeo link. Only `(provider, id)` is stored, after strict validation
  of the host and the id; `embedUrl` (youtube-nocookie / Vimeo `dnt=1`),
  `watchUrl` and the default YouTube thumbnail are rebuilt from it, so no
  user-supplied URL ever ends up in an iframe. The same video can't be
  added twice (409).

## Newsletter API

Routes under `/api/v1/newsletter` (`src/newsletter/`).

| Method & path | Who | Notes |
| --- | --- | --- |
| `POST /newsletter/subscribe` | public | `email`, `source?`; 202 with the same message whatever the state of the address; 5 req/min |
| `POST /newsletter/confirm` | public | `token` from the email (48 h, single use) |
| `POST /newsletter/unsubscribe` | public | `token` from any newsletter; idempotent |
| `POST /newsletter/unsubscribe/one-click?token=` | mail clients | RFC 8058 `List-Unsubscribe-Post` |
| `GET /newsletter/subscribers`, `.../stats` | admin | `status`, `search` (email prefix), `sort` |
| `DELETE /newsletter/subscribers/:id` | admin | Hard delete (GDPR erasure) |
| `GET/POST /newsletter/campaigns`, `GET/PATCH/DELETE /newsletter/campaigns/:id` | admin | `subject`, `content` (rich text, same sanitizer as articles); only drafts can change |
| `POST /newsletter/campaigns/:id/send` | admin | 202; poll `GET /newsletter/campaigns/:id` for `sentCount`/`failedCount` |

- **Double opt-in.** The confirmation link points to
  `APP_WEB_URL/newsletter/confirm?token=…`; the frontend posts the token.
  Confirmation tokens are stored as SHA-256 and expire; at most one
  confirmation email per address every 10 minutes. The subscribe endpoint
  can't be used to find out who is subscribed (same answer, email sent in
  the background). Emails never appear in logs (subscriber ids do).
- **Sending** moves a DRAFT to SENDING atomically (a second send gets 409),
  then delivers to confirmed subscribers in the background (cursor, batches
  of 20, progress saved per batch). Every email has a visible unsubscribe
  link (`APP_WEB_URL/newsletter/unsubscribe?token=…`) and
  `List-Unsubscribe`/`List-Unsubscribe-Post` headers pointing to the API.
- Known limit: delivery runs in the API process. If it stops mid-campaign,
  the campaign stays SENDING with partial counters; a job queue would make
  it resumable.

## Analytics API

Routes under `/api/v1/analytics` (`src/analytics/`).

| Method & path | Who | Notes |
| --- | --- | --- |
| `POST /analytics/views` | public | `type` (`ARTICLE`/`VIDEO`), `id`; 204; 404 if not public; 60 req/min |
| `GET /analytics/popular` | public | `type`, `days` (≤ 90, default 7), `limit` (≤ 20, default 5); cached 5 min |
| `GET /analytics/overview` | admin | `from`, `to` (`YYYY-MM-DD`, ≤ 366 days, default last 30): daily views, totals, top 10 articles/videos, content counts by status, newsletter counts |

- **Cookieless and anonymous.** A visitor counts once per content and UTC
  day, through `HMAC(secret, day | ip | user agent)` kept only in the cache
  until the end of the day; the database only holds daily counters (no IP,
  user agent or visitor id). Bots, crawlers, link previews and scripts are
  ignored.
- Content is read through `ArticlesService`/`VideosService` (batched, public
  only), never through their models.

## Cache & Redis

`src/cache/` provides `CacheService`, used for public reads (articles,
videos, popular content).

- With `REDIS_URL` (`redis://` or `rediss://`), the cache **and the rate
  limiter** live in Redis, shared by every instance. Without it, an
  in-process cache (bounded to 10,000 entries) and the default throttler
  storage are used: fine for a single instance.
- Each namespace has a version counter: a write bumps it (`invalidate`),
  which abandons every key of the namespace in O(1), without `KEYS`/`SCAN`.
  Articles are invalidated on create/update/delete and comment count
  changes, videos on their writes. Taxonomy renames show up after the TTL
  (`CACHE_TTL_SECONDS`, 60 s by default).
- Concurrent misses on one key share a single database query.
- The cache **fails open**: if Redis is down, requests go to MongoDB and a
  warning is logged. `GET /health` reports `redis: { degraded: true }`
  without failing readiness, so a Redis outage doesn't take every instance
  out of rotation.
- Only anonymous, public data is cached, never per-user responses.

## Security

- **Headers** (`main.ts`, helmet): `nosniff`, `X-Frame-Options`,
  `Referrer-Policy: no-referrer`, no `X-Powered-By`; HSTS (2 years,
  `includeSubDomains`) in production; with Swagger off, a strict
  `default-src 'none'; frame-ancestors 'none'` CSP.
- **CORS**: explicit origin list (`CORS_ORIGIN`, comma-separated), required
  in production; methods `GET POST PATCH DELETE OPTIONS`, headers
  `Content-Type Authorization`.
- **Swagger** is off in production unless `SWAGGER_ENABLED=true`.
- **Input**: global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`), DTOs mapped field by field (no mass assignment), flat query
  strings (`query parser: simple`) and `urlencoded` bodies without nested
  objects, so no Mongo operator can come from a request. Rich text is
  sanitized against an allowlist, URLs are validated (https, no
  credentials).
- **Secrets** come from the environment only (validated with zod at
  startup). Query parameters named `token`, `code`, `secret`, `password`,
  `key`, `signature` are redacted from request and error logs.
- **Audit**: admin writes are logged by the `Audit` logger (`article.*`,
  `video.*`, `campaign.*`, `newsletter.subscriber_deleted`, ...).
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit + e2e tests,
  build, `npm run audit:prod` (fails on high/critical advisories in
  production dependencies) and gitleaks secret scanning over the whole
  history. Dependabot keeps dependencies up to date.

`npm run verify` runs lint, typecheck, unit and e2e tests and the build.
See [docs/release-audit.md](docs/release-audit.md) for the security,
performance and release audit, and
[docs/deploiement-vps.md](docs/deploiement-vps.md) to deploy on a VPS
(Docker + Caddy for HTTPS, or PM2).

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
