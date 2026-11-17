# Review — Task 434 (PR #276, patient counts + pagination) — Task 435

Reviewer: independent pass. Verdict: **APPROVE after the fixes in this commit** (no blockers remain).

## Clinic isolation
- Route `GET /api/patients` uses `requireClinicAuth` (clinicId always non-empty, assignment checked). Counts (`stats=1`), pages (`page=`) and the clinic filter `identifier=<CLINIC_IDENTIFIER_SYSTEM>|<clinic>` are applied server-side; page rows are also post-filtered with `matchesClinic`. OK.
- **Fixed (medium):** `countPatientsInMedplum` / `getPatientsPageFromMedplum` silently dropped the clinic identifier when `clinicId` was falsy. The Analytics page passes `resolveClinicIdFromServerScope()` (can be `undefined`), which would have produced a cross-clinic total. Now fails closed (throws; Analytics already falls back via `.catch`).
- **Fixed (medium):** `searchPatientsInMedplum` `name:contains` query had no server-side clinic filter, only a post-filter after `_count=50`; another clinic's matches could crowd out this clinic's results (false "no match", a correctness not leak issue). Added clinic identifier to that query. NRIC/IC queries unchanged (they already use the `identifier` param for the NRIC; combining two `identifier` params needs separate handling, left as follow-up; post-filter still enforces isolation).

## FHIR params vs Medplum docs
- `_summary=count` + `_total=accurate`, `_count`, `_offset`, `_sort=-_lastUpdated`, `active=true`: valid for Medplum 5.2.8 (paginated-search docs). `_offset` ceiling 10,000 handled.
- **Fixed (low):** offset was clamped to 10,000, so pages beyond ~401 repeated the same rows. Now returns an empty page; UI caps total pages.
- Note (not fixed): "New this month" uses `_lastUpdated`, so any edit to an older patient counts as new. Medplum has no creation-date search param; label is approximate. Follow-up: store a `created` extension/identifier or use history `_since`.
- Note: `_sort=-_lastUpdated` with offset paging can show a duplicate/skip if a patient is edited between page loads. Acceptable for a list view; `_cursor` is the Medplum answer if it matters.

## Performance
- Two `_total=accurate` count queries per Patients page load (total and new-this-month) plus one paged query. Both are served by the clinic identifier index; fine at clinic scale. Medplum falls back to an estimate above `accurateCountThreshold`, and the UI handles a null total. Search mode shows ≤50 matches with no pagination (documented in UI).
- Analytics still fetches consultations for up to 300 patients (N+1, pre-existing, out of scope).

## Checks
- `bun test tests/unit`: 240 pass / 0 fail (added a fail-closed + offset-ceiling test). `tsc` shows no errors in touched files.
- Composer, Lab/POCT, sidebar untouched.
