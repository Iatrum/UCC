# Task 380 — /admin redirect loop, stock 500, rate-limit message

Env: dev server `next dev --webpack -p 3380` (worktree `/home/dev/ucc-task380`, base `origin/dev`), dev Medplum `127.0.0.1:8113`, fake data. Server killed afterwards.
Docs consulted: Next.js 16 `proxy.ts` (renamed middleware) + `redirect()` in layouts; Medplum core `isNotFound` / `OperationOutcomeError` (`@medplum/core` 5.x); FHIR R4 OperationOutcome `not-found`.

## 1. /admin redirect loop — NOT reproducible on current dev
- Already fixed by Task 310 (`lib/login-redirect.ts` `decideLoginRedirect` loop guard, `?error=admin_required` shows a notice instead of bouncing).
- Live Playwright, localhost: anon `/admin` → `/login?next=/admin` (stops); non-admin doctor `/admin` → `/login?error=admin_required&next=/admin` and stays (4 navigations, no loop).
- Separate bug found while checking proxy: `admin.<base>/admin[/x]` was 308-redirected to `<base>/admin/admin[/x]` (404). `proxy.ts` prefixed `/admin` unconditionally. Fix: idempotent `adminPortalPath()` in `lib/server/subdomain-host.ts`, used by `proxy.ts`.
- Could not verify real production host/cookie topology (no access by design); if a loop is still seen in prod, capture the `Location` chain + `auth/me` result for the session.

## 2. Stock/inventory 500
- `/api/inventory` GET/POST/PATCH/DELETE edge cases (missing id, bad JSON, negative/str stock, non-object body) all return 400/404 already (Task 310 + `593e2e5`). `/inventory` page renders, no console errors.
- Reproduced the 500: `GET /api/purchases?id=<missing or non-purchase id>` (and `PATCH` with unknown id, used by receive-stock) → `medplum.readResource` throws OperationOutcomeError "Not found" → `handleRouteError` fell through to 500.
- Fix (central, small): `handleRouteError` maps `OperationOutcomeError` with `isNotFound(outcome)` → 404 `{error:"Not found"}`. Other Medplum errors still 500. Purchasing writes remain feature-flag disabled (403), unchanged.

## 3. Rate limit shown as "wrong password"
- Already fixed: `classifyAuthError` + login page distinguish `AUTH_RATE_LIMITED` (Task 310); #252 (Task 356) only anchors the prefix match and adds tests. No change here, no overlap with #252 files.

## Tests
- `tests/unit/task380-admin-stock.test.ts` (5 tests, no module mocks): not-found→404, other errors stay 500, `adminPortalPath` idempotence, proxy admin-subdomain redirect.
- `e2e/tests/task380.spec.ts`: API 404s (purchases, inventory) — passed against :3380 under `timeout`.
- Full unit suite 159 pass; `tsc --noEmit` clean.
