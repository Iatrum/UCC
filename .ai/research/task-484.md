# Task 484 - full gate on origin/dev after ~25 merged PRs

Base: `origin/dev` @ 115a40d (merge of #277). Fake data, dev Medplum `127.0.0.1:8113` only, one server on `:3484`.
Open PRs #267 #276 #278 #279 #280 #281 #282 were not touched.

## Static gate
| step | result |
|---|---|
| `bun test tests/unit` | 444 pass, 0 fail |
| `tsc --noEmit` | exit 0 |
| `bun run lint` | exit 0 |
| `build:ci` (via check-all) | exit 0 |

## E2E triage

### Real product bug (NOT fixed here, reported)
**Consultation history is empty once a clinic has >= 20 period-less encounters.**
`getPatientConsultationsFromMedplum` (`lib/fhir/consultation-service.ts`, ~l.664-690) searches
`Encounter?identifier=clinic|<id>&_sort=-date` with the default page size (20) and only afterwards filters by
patient. Medplum sorts encounters without `period` (check-in/queue encounters, status `in-progress`) first for `-date`,
so after 20 of them the page contains no consultation at all. Symptoms: patient profile "No consultation history yet",
"Consult Required" toast on the Treatment tab, composer cannot open (a composer-blocking regression for that clinic).
Repro on dev Medplum: 21 stale fake in-progress encounters -> `GET /api/consultations?patientId=<p>` returns
`{"count":0}` right after a successful `POST /api/consultations`; after giving them an old `period.start` it returns 1.
This one cause explained 18 of the 30 failures in the first full run (composer-plan*, draft-retention, poct*, xray*, time-chit,
workflow 04-09 partially); the other 12 are listed below.
Not fixed here because `lib/fhir/consultation-service.ts` is also changed by open PR #282 (same function, child `_count`).
Suggested fix: also filter the search by `identifier=firebase-patient|<patientId>` (keep `matchesClinic`), and/or
page through results / pass an explicit `_count`; same for `getRecentConsultationsFromMedplum`.
`prune-fake-queue.ts` only touches *dated* encounters, so it never cleans these.

### Fixed in this PR (e2e spec drift, no product code)
- `e2e/tests/workflow.spec.ts` 09 and `dashboard-load-errors.spec.ts` Billing: Task 432 added a second link
  (`aria-label="Open checkout for <name>"`) per billing row -> strict-mode violation. Use `.first()`.
- `dashboard-load-errors.spec.ts` queue stubs used `name`; the queue table renders `fullName` (blank row, never visible).
- `dashboard-load-errors.spec.ts` "navigating away": relied on a "Patients" link that is not in the sidebar and on a
  1.5 s fixed delay that races the dev compile. Now clicks Inventory and releases the aborted request only after the
  client-side navigation committed.
- `workflow.spec.ts` 02: `[name=nric]` briefly resolves to two inputs (the form remounts once after load; the second one
  is empty). The fill is now retried until name and NRIC stick. The remount itself is unexplained (see below).

### Environment / flaky (not regressions)
- `save-state.spec.ts` (5): writes screenshots to `/workspace/ai-logs/...`; set `UCC_SAVE_SHOTS` (check-all does).
- `api.spec.ts` smoke ECONNRESET and `xray-phase2` default-deny: pass in isolation (dev server under load / state left by killed runs).
- Next dev "approaching the used memory threshold, restarting" when the heap is capped at 2048 MB -> ERR_CONNECTION_REFUSED
  mid-run (workflow 02 in the last full run). Use the 3072 MB cap and restart the server between long runs.
- `xray-phase3` is skipped: needs the local PACS stack (`infra/pacs-dev` state) which is not set up on this host.
- `staff-membership.spec.ts`: failing in the baseline too. Without `UCC_MEMBERSHIP_BACKUP_DIR` the CLI refuses
  ("Stopped; inspect locally"). With it the run reaches `forged foreign Patient create` and gets **201 instead of 403**.
  Most likely the dev Medplum AccessPolicy was not re-applied after the policy changes (see next item), but nobody
  verified that, so a human should rerun it after re-applying the policies. Two membership backups remain in
  `/home/dev/ai-logs/task484/membership-backups/`.
- `e2e/scripts/clinic-check.ts` exits 1: `Forbidden` searching `MedicationDispense` (new in Task 358). The fix for staff
  access is in `scripts/setup-access-policies.ts` but has to be **re-applied to each Medplum instance**. Dev has not been.
  **Check production before/at deploy of Task 358**, otherwise checkout stock deduction audit writes get 403.

### Open observation
`/patients/new` can render two `name=nric` inputs for a moment (hydration/remount). Screenshots show one field. Not reproduced
in isolation; left as an observation.

## Gate results on the fixed specs
- Targeted re-run (fresh server): dashboard-load-errors 5/5, workflow 01-10 pass (11 = baseline expected fail), xray-phase2 2/2.
- Last full run: 70/82, remaining = staff-membership (baseline), workflow 02 -> cascade 03-10 (server memory restart, see above),
  11 (baseline), xray-phase3 (skipped, PACS). **No single full run is green on the fixed tree.**
- Logs: `/home/dev/ai-logs/task484/` (not committed).
