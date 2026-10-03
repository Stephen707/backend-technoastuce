# Release audit — videos, newsletter, analytics, cache

Scope: the modules added in this release (Videos, Newsletter,
Analytics, Redis cache), the hardening of `main.ts`/config, and a review of
the existing modules they touch. Status as of 2026-10-02.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | 0 warnings, 0 errors |
| Typecheck | `npm run typecheck` | OK |
| Unit tests | `npm test` | 16 suites, 246 tests passed |
| E2E tests (in-memory MongoDB) | `npm run test:e2e` | 3 suites, 75 tests passed |
| Build | `npm run build` | OK |
| Production dependencies | `npm run audit:prod` | 0 vulnerabilities |
| Secrets in git history | gitleaks (CI) + manual grep | none found; `.env` never committed |

`npm run verify` runs the first five in sequence.

## Security

### Fixed in this release

| Finding | Risk | Fix |
| --- | --- | --- |
| CORS reflected any origin with credentials when `CORS_ORIGIN` was unset | Any site could call the API with the user's credentials | Explicit origin list, required in production; methods/headers allowlisted |
| Swagger UI always exposed | API surface disclosure in production | Off in production unless `SWAGGER_ENABLED=true` |
| HSTS left to helmet defaults, also in development | Missing/unwanted HTTPS pinning | 2 years + `includeSubDomains` in production only |
| Default CSP on a JSON API | Weaker than needed | `default-src 'none'; frame-ancestors 'none'` when Swagger is off |
| Tokens in query strings would be logged | Credential leak via logs | `redactUrl` in the request logger and the exception filter |
| `urlencoded` bodies parsed with `qs` (nested objects) | NoSQL operator injection surface | `extended: false`, 16 kB limit; query parser explicitly `simple` |
| Rate limits per process only | Limits multiplied by the instance count | Redis-backed throttler storage when `REDIS_URL` is set |

### Controls of the new modules

- **Videos**: only a validated `(provider, id)` is stored; every URL sent to
  clients is rebuilt server-side.
- **Newsletter**: double opt-in, hashed expiring confirmation tokens,
  enumeration-safe subscribe, RFC 8058 one-click unsubscribe, no emails in
  logs, GDPR hard delete.
- **Analytics**: no personal data stored (daily counters only), HMAC visitor
  ids that rotate daily, bots ignored.
- **All**: strict DTOs (whitelist + forbidNonWhitelisted), explicit field
  mapping (no mass assignment), `@AdminOnly()` on every write, audit log
  lines for admin actions, per-route throttles on public writes.

### Open items (not changed, decision needed)

1. ~~**Dev dependency advisories** from `@nestjs/mau`~~ — removed (unused
   deploy CLI); `npm audit` now reports 0 vulnerabilities.
2. ~~**Unused dependency**: `bcrypt` / `@types/bcrypt`~~ — removed
   (passwords use argon2).
3. **HSTS preload** is not enabled: only opt in once every subdomain is
   HTTPS-only.

## Performance

- **Indexes** for every query path of the new collections: unique
  `(provider, providerVideoId)`, publication indexes and a French text
  index on videos;
  `(status, createdAt)`, `(status, _id)` and token indexes on subscribers;
  a single compound `(targetType, day, target)` unique index serving
  analytics upserts, popular content and daily totals.
- **Projections and `lean()`** everywhere; listings never load bodies or
  descriptions; `limit` ≤ 100 and `page` ≤ 10,000.
- **No N+1**: refs populated with one `$in` query per path; analytics
  resolves top content with one batched query; campaign delivery streams
  subscribers with a cursor in batches.
- **Aggregations in MongoDB** (`$group` on indexed matches) for stats,
  popular content and the overview; overview range capped at 366 days.
- **Cache** for public reads with O(1) namespace invalidation and request
  coalescing; HTTP `Cache-Control` on public routes.
- **Payloads**: JSON 512 kB (article bodies), urlencoded 16 kB.

Known limits:

- `autoIndex` stays on (Mongoose default): new indexes are built at startup.
  On large production collections, build them ahead of a deploy.

## Release checklist

- [ ] `CORS_ORIGIN` lists every frontend origin (production refuses to
      start without it).
- [ ] `API_PUBLIC_URL` is set (one-click unsubscribe links).
- [ ] `REDIS_URL` is set when running more than one instance.
- [ ] Frontend pages exist for `/newsletter/confirm` and
      `/newsletter/unsubscribe` (they POST the `token` to the API).
- [ ] `TRUST_PROXY=true` is set behind the reverse proxy.
- [ ] CI is green (lint, typecheck, tests, build, audit, gitleaks).
