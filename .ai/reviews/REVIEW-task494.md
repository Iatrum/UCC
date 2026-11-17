# Review: Task 494 (PRs #278, #279, #281) — Task 495

**Verdict: APPROVE** (all three). No code fixes needed. Branch tips reviewed: #278 1d65ef7, #279 6c6bc10, #281 7e54d19 (each 0 commits behind `origin/dev` 66f596b, GitHub reports MERGEABLE).

## Checks (on each branch tip; all already contain current dev)
| | unit tests | `bun run lint` (tsc + clinic-admin check) | eslint on changed files |
|---|---|---|---|
| #278 ai/task-446 | 555 pass / 0 fail | pass | clean |
| #279 ai/task-458 | 561 pass / 0 fail | pass | clean |
| #281 ai/task-472 | 564 pass / 0 fail | pass | clean |

- **Dev behaviour kept:** three-dot diffs of each branch against dev touch only the PR's own files. #276 (`lib/fhir/patient-service.ts` counts/paging, patients list) and #280 are not touched by any branch and are present after merge; their tests still pass.
- **#278:** `withSignedConsultation` shows the just-signed consult at once (deduped by id, `router.refresh()` still called); history table wrapper has `overflow-x-auto`; empty-state Start button hidden while the drawer is open. Composer untouched.
- **#279:** `/api/orders` reads the consultation first via `getConsultationFromMedplum(id, clinicId)` (clinic-scoped, other clinic reads as 404), derives the patient from it, and rejects a caller `patientId` that differs. `/api/billing` and the checkout button both reject RM 0 / no lines (NaN also blocked). Client uses the resolved patient id for plan draft and checkout.
- **#281:** `getTriageQueueForToday` follows `next` links (cap 50 pages, logged); dashboard waits for the session, shows error + Retry; auth requests time out after 15s into the existing error state.
- No sidebar/nav changes; no `.env`/secrets in any diff (only the words in review prose); no Lab/POCT code touched.

## Findings (non-blocking)
1. **#278 wording vs. brief:** the task brief says "visit stats only after checkout". The PR does not gate on checkout; it relabels the stats "Last consult" / "Total consults" and counts every consultation (signed or not yet billed). This is honest labelling, but if the product wants true *completed-visit* stats (checkout done only) that is not implemented. Decide before merge.
2. #278: the stat counts raw consultations while the table merges same-day visits, so the two can differ.
3. #279: `/api/billing` POST does not itself check that the posted `patientId` belongs to `consultationId` (pre-existing, not changed here). Worth a follow-up.
4. Not browser-verified (no dev server, as instructed).
