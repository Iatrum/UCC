# Production Readiness

Last updated: 2026-03-30

## Status

- `bun run lint`: passes
- `bun run build`: passes
- Major admin auth regressions previously found were fixed
- Login response no longer returns the Medplum bearer token

Current assessment:

- Build-ready
- Not yet fully production-ready for a healthcare deployment

## Launch Blockers

### 1. Full E2E verification is still missing

Files:

- `playwright.config.ts`
- `tests/e2e/**`
- `tests/e2e/support/env.ts`

Problem:

- This audit did not complete a fresh successful Playwright run against the intended environment

Why it matters:

- Build success does not prove real login, routing, session persistence, admin flows, or clinical workflows

## Resolved in this repo (trust boundary)

- Admin vs clinic **UI shell** and clinic subdomain validation use **Host** (and `x-forwarded-host`) plus path/cookie fallbacks for localhost — not `medplum-is-admin` / middleware-mirrored `medplum-clinic` cookies.
- `proxy.ts` (Next.js 16 proxy layer) no longer sets those context cookies; `medplum-is-admin` was removed from login.
- `medplum-clinic` may still be set by **login** and **`/api/auth/medplum-session`** (`httpOnly: false`) for localhost and optional client sync; APIs prefer host-derived clinic when on a clinic subdomain.

## Non-Blocking Risks

### AI route logging should be kept metadata-only

Files:

- `app/(routes)/api/smart-text/summary/route.ts`
- `app/(routes)/api/soap-rewrite/route.ts`

Note:

- Logging is better than before, but clinical text handling in logs should stay under review

### Test defaults still point at hosted domains

Files:

- `playwright.config.ts`
- `tests/e2e/support/env.ts`

Note:

- Prefer a dedicated staging environment instead of production-like default hosts

### Build warning: outdated browser mapping data

Note:

- `baseline-browser-mapping` emits a warning during build
- Not a release blocker

## Verified In This Repo

- Admin vs clinic portal UI derives from request host (and path/cookie fallbacks), not `medplum-is-admin`
  - `lib/server/subdomain-host.ts`, `proxy.ts` (Next.js 16 network proxy), `app/layout.tsx`
- Admin clinic creation requires platform-admin auth
  - `app/api/admin/clinics/route.ts`
- Admin Medplum client creation requires platform-admin auth
  - `app/(routes)/api/admin/create-medplum-client/route.ts`
- Login response no longer includes `accessToken`
  - `app/api/auth/login/route.ts`
- POCT order flow now calls the real API
  - `app/(routes)/poct/new/page.tsx`
- PACS order flow now calls the real API
  - `app/(routes)/pacs/new/page.tsx`
- Lint uses a dedicated TypeScript config
  - `package.json`
  - `tsconfig.lint.json`

## Last Verified Checks

- `bun run lint`
- `bun run build`

Both passed on 2026-03-30 in this workspace.

## Next Actions

1. Run and document full Playwright verification on staging
2. Keep AI-route logging limited to metadata
3. Move test defaults away from production-like domains
4. Optional: make `medplum-clinic` httpOnly-only and drive client clinic state from host + server APIs
