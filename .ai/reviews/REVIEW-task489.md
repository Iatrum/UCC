# Review of Task 489 (Task 490)

Scope: draft PRs #279 (`ai/task-458`, head 693172e) and #281 (`ai/task-472`, head 52cc95c). Fake data only; no dev server started.

## Verdict: APPROVE (both)

## Checks
- **Dev merges kept dev behaviour.** Both heads contain `origin/dev` (afa3216), 0 commits behind. `git diff origin/dev..HEAD` shows only each PR's own changes (#279: checkout guards, orders/billing routes, checkout-client; #281: queue pagination, dashboard gate, auth timeout). No conflict markers; none of dev's stock-deduction/billing code was altered.
- **Checkout blocks RM 0.** `hasBillableItems` is enforced in `POST /api/billing` (400, no invoice created) and in the client (button disabled + warning). Covered by `task458-checkout.test.ts`.
- **Patient resolved inside the caller's clinic.** `GET /api/orders` reads the consultation with the caller's `clinicId` first (404 if foreign), derives the patient from it, rejects a mismatching `patientId`, and reads the patient clinic-scoped. Tests: foreign consultation, foreign/mismatched patientId, no patientId.
- **Queue pagination.** `getTriageQueueForToday` follows `next` links (cap 50 pages, logged); tests cover 250 finished + 1 new, meds_and_bills kept, clinic B never returned (also with a leaky server), cap logging.
- **Auth timeout reaches Retry.** `refreshAuthState` uses `fetchWithTimeout` (15s). The abort rejects, the provider's `.catch().finally()` sets `loading=false`, the dashboard gate (`authReady`) opens, `loadQueue` runs, and any failure becomes `error` + Retry via `QueueState` (queue fetch has its own 10s timeout). A 401 yields "session not ready" + Retry.
- **Session-gate test fails without the gate.** Mutation-tested on a scratch copy (restored): removing `if (!authReady) return;`, changing the deps to `[]`, or dropping `|| !authReady` from the spinner each fails `dashboard session-ready gate`.
- **Unit tests / types / lint.** #279: 551 pass, 0 fail; #281: 554 pass, 0 fail. `bun run lint` (tsc + clinic-admin check) clean on both. No secrets/.env touched; no sidebar/nav changes.

## Notes (non-blocking)
- The gate test is a source-text regex, so it is brittle against refactors; a React render test would be sturdier.
- `fetchWithTimeout` only bounds the time to response headers, not the body read.
- Pre-existing and out of scope: `POST /api/billing` trusts the body `patientId`.

No code changes were needed, so no fix loops were used.
