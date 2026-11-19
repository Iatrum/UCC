# Task 649 - clinic-scoped, fully paged list searches (follow-up to Task 645 G10)

## Problem
`GET /api/suppliers` searched every supplier Organization with `_count=200` and filtered by clinic in code. `_count` is only a
page size, so once all clinics together held >200 suppliers a clinic could silently lose rows (not a leak, a correctness bug).
Same pattern audited across the routes in task-645.md.

## Fix
- New `lib/server/search-all.ts` `searchAllPages(medplum, type, params, pageSize=100)`: wraps `MedplumClient.searchResourcePages`
  (follows Bundle `next` links, `cache: no-cache`). Accepts `URLSearchParams` so a key can repeat (repeated `identifier` = AND).
- `GET /api/suppliers`: search is `identifier=urn:iatrum:organization-type|supplier` AND `identifier=clinic|<id>`, all pages.
  In-code `belongsToClinic` stays as defence in depth. Response shape unchanged.
- Same class, fixed the same way:
  - `GET /api/settings/insurers`: was all insurers `_count=500` then filter; now `identifier=clinic|<id>`, all pages.
  - `getClinicalCatalogItems` (`/api/catalogs`): already clinic-scoped but capped at 200 with one page; now all pages.
  - `listBillingExceptionTasks` (`/api/tasks`): already clinic-scoped but one page of 100; now all pages.
- Reviewed, not changed: purchases (`listClinicPurchaseOrders` already scoped + paged), follow-up (not a list-then-filter), auth/membership
  lookups (`_count` 10/100 on per-user/per-clinic org lookups, bounded by design), admin-service platform lists (platform admin, not clinic data;
  `_count=200/500` caps there are a separate platform-admin item, left open - see below).

## Tests
`tests/unit/task649-clinic-scoped-lists.test.ts` (fake Medplum replays AND-of-identifiers and paging; single-page `searchResources` throws):
own clinic only + search carries clinic identifier; 450 own rows interleaved with 300 foreign not truncated; foreign rows never returned
(also when the search layer leaks); insurers 520 rows complete; helper follows all pages. Run under default TZ and `TZ=America/New_York`.

## Open
- `lib/fhir/admin-service.ts` platform-admin lists (`Organization/Practitioner _count=200`, `PractitionerRole 500`) and the
  consultation-service bulk child reads (`BULK_CHILD_COUNT`) are single-page; not clinic data lists in the G10 sense. Candidates for a follow-up.

Refs: Medplum search/paging https://www.medplum.com/docs/search/paged-search ; FHIR R4 search (repeated param = AND) https://hl7.org/fhir/R4/search.html#combining
