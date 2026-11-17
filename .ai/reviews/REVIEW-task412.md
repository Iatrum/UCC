# Review — Task 413 of draft PR #270 (Task 412, branch ai/task-412-backlog-bugs)

Verdict: APPROVE (docs-only). Reviewed head cf20017 against dev e6c8278.

## What the PR is
Two files: `.ai/BACKLOG.md` (marks the "Later" bug line done) and `.ai/research/task-412.md`. No code or test changes. The claim is that all three bugs were already fixed on dev.

## Root-cause check (code read on cf20017)
- (a) /admin loop: `decideLoginRedirect` in `lib/login-redirect.ts` returns `admin-notice` when `isAdminRequired`, so the login page no longer navigates back to /admin. Cause was the login page redirecting an "admin" client back to /admin after the server had rejected it. `adminPortalPath` (used in `proxy.ts`) is idempotent, which fixes the `/admin/admin` variant. Root cause addressed.
- (b) Rate limit shown as wrong password: `app/api/auth/login/route.ts` maps upstream 429 to `AUTH_RATE_LIMITED` (429 plus Retry-After) and 5xx to `AUTH_UNAVAILABLE`. `classifyAuthError` anchors on the code prefix, so a coded error is no longer reclassified as credentials. Root cause addressed.
- (c) Stock 500: `handleRouteError` maps Medplum OperationOutcome not-found to 404, and inventory validation returns 400/404. Root cause addressed.

## Regression tests fail without the fix (mutation check, worktree reverted afterwards)
| Fix removed | Result |
|---|---|
| `if (args.isAdminRequired) return admin-notice` deleted | 1 fail |
| rate-limit branch of `classifyAuthError` disabled | 2 fail |
| `isNotFound` mapping in `handleRouteError` disabled | 1 fail (4 pass) |

## Checks
- `bun test` auth-errors, inventory-validation, task380-admin-stock: 27 pass, 0 fail (re-run). With auth-login-route also included, no failures on the unmutated tree.
- `tsc --noEmit` clean. `bun run lint` (tsc lint config plus clinic-admin check) clean.
- No sidebar/nav, composer, Lab/POCT, Firebase or clinic-scoping files touched. No secrets or env files in the diff (grep hits are the words "wrong password" in prose).

## Notes (non-blocking)
- The (b) test coverage is for the classifier; the 429 mapping in the login route itself is covered by `auth-login-route.test.ts` in draft PR #252, not by this PR's three files.
- Dev server not started (unit/static review only), so no fresh live repro; relies on the Task 380 live repro cited in the notes.
- CI at review time: lint-and-build pass, live-routes check pass, Vercel preview pending.
