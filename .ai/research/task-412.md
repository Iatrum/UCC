# Task 412 — BACKLOG "Later" bugs: /admin loop, rate-limit message, stock 500

Result: all three are already fixed on origin/dev (e6c8278). No code change; BACKLOG line marked done.
Method: code read + unit tests in a worktree on origin/dev (RAM ~3.3 GB free, so no dev server started; unit tests only). Prior live repro is in `.ai/research/task-380.md`.

## (a) /admin redirect loop — fixed
- Server layout sends non-admins to `/login?error=admin_required&next=/admin` (`lib/server/medplum-auth.ts:316`).
- `lib/login-redirect.ts` `decideLoginRedirect` returns `admin-notice` instead of navigating back to `/admin` (Task 310, commit 0c46452); login page uses it (`app/(routes)/login/page.tsx`).
- Task 380 also fixed `admin.<base>/admin` becoming `/admin/admin` via idempotent `adminPortalPath`.
- Tests: `tests/unit/auth-errors.test.ts` ("decideLoginRedirect (/admin loop guard)"), `tests/unit/task380-admin-stock.test.ts`.

## (b) Rate limit shown as "wrong password" — fixed
- `app/api/auth/login/route.ts` returns `AUTH_RATE_LIMITED` (429, Retry-After) and `AUTH_UNAVAILABLE` (503); bad credentials stay `AUTH_CREDENTIALS` 401. `lib/auth-errors.ts` classifies on the code prefix; login page shows a wait message.
- Overlap note: draft PR #252 (Task 356) touches `lib/auth-errors.ts`, `tests/unit/auth-errors.test.ts`, `tests/unit/auth-login-route.test.ts` (prefix anchoring + tests). This task touches none of them.

## (c) Stock 500 — fixed
- `/api/inventory` bad input returns 400/404 (`lib/fhir/inventory-validation.ts`, `inventory-service.ts`, Task 310).
- `/api/purchases` missing/non-PO id (used by receive-stock) threw OperationOutcomeError -> 500; `handleRouteError` now maps Medplum not-found to 404 (Task 380); non-PO Basic 404 in Task 383.
- Tests: `tests/unit/inventory-validation.test.ts`, `tests/unit/task380-admin-stock.test.ts`.

## Verification
`bun test tests/unit/auth-errors.test.ts tests/unit/inventory-validation.test.ts tests/unit/task380-admin-stock.test.ts` -> 27 pass, 0 fail.
Sources: Next.js redirect https://nextjs.org/docs/app/api-reference/functions/redirect ; Medplum rate limits https://www.medplum.com/docs/rate-limits ; RFC 6585 §4.
