# Task 565 - review of Task 564 (PR #308, head 19f08e3)

**Verdict: approve (one test-strengthening fix added).**

- Age/gender: 8 `Patient?_summary=count&_total=accurate` queries (4 buckets x male/female), each with `active=true` + `identifier=clinic|<id>`; buckets are contiguous/non-overlapping (gt/le cutoffs, 40y born exactly today falls in 40-64). Cached 5 min per clinic (key includes clinicId). Counts cannot be re-filtered client-side, so isolation relies on the identifier search param (same as the other count queries). Limit: `other`/`unknown` gender and no birthDate excluded (documented).
- Most-dispensed: `status=completed` + `whenhandedover` window, `_elements` trimmed, max 3 pages x 1000, rows re-filtered with `resourceMatchesClinicTenant`, per-clinic cache key. `whenhandedover` was verified live on dev Medplum 5.2.8 (task-564 notes). Rows lacking whenHandedOver are excluded (writer sets it at finalisation).
- Query count: 8 counts + 5 bounded searches + 4 follow-up counts, all parallel and cached.
- Tests: assertions were meaningful but checked only 2 of 4 bucket cutoffs; added the 18-39 and 40-64 cutoffs.
- Checks: `tsc --noEmit` clean; `bun test tests/unit` 686 pass / 0 fail; PR MERGEABLE (draft, base dev).
- Minor, not changed: `ageCutoffs` uses setUTCFullYear (29 Feb edge shifts by a day, negligible).
