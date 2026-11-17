# Independent review — Task 478 (server-side paged patient search), PR #276

Reviewed head: `6ab5569` (branch `ai/task-434`). Reviewer: Task 479. Verdict: **APPROVE** (after one small fix pushed by the reviewer).

## Verified
| Check | Result |
|---|---|
| Search covers all pages of the clinic | PASS. Live dev Medplum, clinic `demo` (1518 patients): name search "a" paged 20 pages x 25 -> 500 unique ids == reported total. Search is server-side, not limited to the loaded page. |
| Phone search | PASS. `phone:contains` is a token modifier, which the Medplum docs only describe for string params, so verified empirically on 5.2.8: nonsense value -> 0, partial digits -> superset of exact match. Unit tests cover as-typed, separators and partial. |
| NRIC search | PASS for exact value (`nric\|X`, `ic\|X`). Partial NRIC is NOT supported (`identifier:contains` returned 0 live) - see Notes. |
| Name search | PASS (`name:contains` + clinic identifier filter). |
| Clinic isolation | PASS. Name/phone sub-queries carry the clinic identifier; NRIC sub-queries are global exact lookups and are post-filtered with `matchesClinic`; `clinicPatientParams` fails closed without a clinic. Live: clinics b/c/d/demo, 0 foreign rows in results. Mutation: removing the post-filter fails the isolation test. |
| Paging/reset | PASS. Page resets to 1 when the debounced query changes (incl. clearing); stale responses dropped via `cancelled`; page size clamped 1..100; offset ceiling handled. |
| No sidebar/nav/composer/e2e/env/secret changes | PASS (file list: patients page, analytics, api/patients, patient-client/service, tests, .ai docs). Secret-pattern grep of the diff clean. |
| X-ray toggle / POCT | PASS, untouched. No new POCT features. |
| Tests fail without the change | PASS. Mutations: drop clinic post-filter -> 1 fail; window 500->20 -> 1 fail; remove phone queries -> 2 fail. Base `origin/dev` has no `searchPatientsPageInMedplum` at all. 10/10 unit tests pass on head. |
| Lint/tsc | eslint clean on page.tsx; tsc no errors in touched files. |

## Finding fixed in this review
- **Cap not surfaced (small, fixed):** each sub-query pulls at most `PATIENT_SEARCH_WINDOW` (500) rows, so a very broad term in a large clinic reports `total=500` with `capped=true`, but the UI discarded `capped` and showed "500 matches" as if exact. The page now shows "500+ matches - refine your search to narrow results".

## Notes (not blocking)
- Partial NRIC no longer matches (old client-side filter did substring on the loaded 200 rows; the server search was already exact-only). Full NRIC and name/phone work. Consider a follow-up if staff search by NRIC prefix.
- "New patients this month" (Task 434) counts `_lastUpdated >= month start`, so edited old patients count as new. Pre-existing semantics from 434, outside 478.
- `setPage(1)` is called inside a `setDebouncedQuery` updater; it is idempotent and works, but a side effect in an updater is an anti-pattern.
