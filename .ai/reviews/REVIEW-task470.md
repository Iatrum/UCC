# Review note — Task 470 merge on this branch (Task 471)

Merge `46cc089` (dev `115a40d` into `ai/task-446`): **APPROVE**, no fixes needed.
- Net diff vs dev is only Task 446's files (profile page/workspace, `lib/patients/profile-history.ts`, its unit test, `.ai` notes). Deletions are only the old header labels, the unwrapped history table div, the unconditional Start-consult button and the unmerged consultation list. Dev's dashboard (430/452), billing (432), dispensing (358), MC/referral (408), analytics (460) code and `.ai` entries are all retained.
- Composer untouched (the workspace only mounts it as before); no sidebar/nav, e2e, env or secret files; clinic data handling unchanged.
- tsc (`tsconfig.lint.json`) clean, eslint on touched files clean, `bun test tests/unit`: 448 pass, 0 fail.
- PR #278: MERGEABLE; CI pass at review time. Full review in `ai/task-434:.ai/reviews/REVIEW-task470.md`.
# Review — Task 470 conflict merges (Task 471)

Scope: independent review of the dev merges on PR #276 (`ai/task-434`, merge `355ab86` + lint fix `5d74a38`) and PR #278 (`ai/task-446`, merge `46cc089`). Both merged against dev `115a40d`.

## Verdict: APPROVE both (no fixes needed)

## Method
Net diff of each branch vs `origin/dev` (`git diff origin/dev origin/ai/task-N`), deletions listed, then tsc + eslint + unit tests in a clean worktree (node_modules symlinked, same package.json as dev).

## #276 (Task 434)
- Merge kept dev behaviour: the net diff vs dev removes only the old `getAllPatients(200)` loading, the capped stat cards and the client-side filter in `patients/page.tsx`, plus one analytics line (`totalPatients = patients.length`). Nothing from dashboard states (430/452), billing (432), dispensing (358), MC/referral (408) is touched. Analytics keeps Task 460's placeholder/chart layout; only the total now uses the exact count with a `?? patients.length` fallback.
- PR intent intact: exact clinic-scoped counts (`_summary=count`, `_total=accurate`), server paging (25/page), server search; `.ai/CHANGELOG.md` merge kept all dev entries (additions only).
- Clinic isolation: counts/pages fail closed without a clinic id, filter by `identifier=<clinic system>|<id>`, and re-check `matchesClinic`; name search now also filters by clinic server-side.
- Lint fix `5d74a38` resets the page inside the debounce callback; behaviour is the same as before.
- No sidebar/nav, composer, e2e or env/secret files in the diff; grep for key/secret/password patterns is clean.
- tsc (`tsconfig.json` and `tsconfig.lint.json`) clean; `check-clinic-admin-medplum` ok; eslint on touched files clean; `bun test tests/unit`: 449 pass, 0 fail.

## Non-blocking notes (pre-existing in Task 434, documented there)
- "New this month" counts `_lastUpdated >= month start`, so a patient edited this month may be counted as new (createdAt maps to `meta.lastUpdated` in this app).
- Follow-ups / In Queue cards still describe the current page only; search by phone no longer works in the list.

## Live state
PR #276: MERGEABLE; CI (lint-and-build, live routes, Vercel) pass at review time.
