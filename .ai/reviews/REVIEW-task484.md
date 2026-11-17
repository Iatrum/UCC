# Review of Task 484 (PR #284, draft, base `dev`)

Reviewer: Task 485. Reviewed head 9d75b1e. Diff vs origin/dev: 3 files (`.ai/research/task-484.md`, `e2e/tests/dashboard-load-errors.spec.ts`, `e2e/tests/workflow.spec.ts`).

## Verdict: APPROVE (spec-only fixes; follow-ups listed below)

## Checks
| check | result |
|---|---|
| Fixes address root cause | Yes. Billing `.first()`: Task 432 added a second `Open checkout for <name>` link per row (`components/billing/billing-table.tsx`). Queue stubs: `components/queue-table.tsx` renders `patient.fullName`, stub sent `name`. Navigate-away: replaced a fixed 1.5 s race with release-after-navigation. |
| Sidebar/nav changes | None (no file under `components/` or `app/` touched). |
| Composer changes | None. |
| Secrets/.env | None in diff (grep for secret/password/token/.env hits only a screenshot path). |
| Clinic data separation | No product code touched; the consultation-list finding is clinic-scoped and unaffected. |
| X-ray toggle / POCT | No change. No new POCT features. |
| Tests fail without the change | Reasoned, not rerun: old locators are strict-mode violations (2 matches), and old stubs render a blank row, so the old specs fail deterministically. The queue-stub fix was confirmed against the component. |
| Gate | Static gate green (unit 444/0, tsc, lint, build:ci). E2E: no single green run; remaining failures are explained (staff-membership baseline, clinic-check MedicationDispense policy not re-applied on dev, PACS-dependent xray-phase3 skipped, server restart at 2 GB heap). I did not rerun the full e2e gate (RAM shared with production). |

## Findings (non-blocking)
1. **workflow 02 retry may mask a real bug.** The `toPass` retry hides a form remount that drops typed input. If it happens to users, typed data is lost. The note says "unexplained"; it should become a BACKLOG item.
2. **Real regression remains unfixed**: `getPatientConsultationsFromMedplum` (`lib/fhir/consultation-service.ts`) searches with the default page size of 20 and filters by patient afterwards. I confirmed this in the code. It can leave a clinic with 20+ period-less encounters unable to open the composer. Needs a follow-up task (coordinate with #282, same function) and a BACKLOG entry. Until then the "Done" bar in AGENTS.md is not strictly met; the PR is honest about it.
3. **Needs a human**: re-apply access policies on dev, and check production before deploying Task 358 (`MedicationDispense` Forbidden).
4. Branch base is 115a40d; origin/dev has moved on. A merge simulation with current origin/dev is clean.
