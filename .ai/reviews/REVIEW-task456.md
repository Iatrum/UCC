# Review of Task 456 (PR #280) — Task 457

Verdict: **APPROVE** (after one small fix applied in this review)

## Checks
- **Counts logic**: "Order soon" = `0 < stock <= min`, out-of-stock = `stock <= 0`; tiles no longer double count; in-stock = total − out-of-stock. Unit-tested.
- **Link to filter**: "N more" button switches to Overview with an Order soon filter; correct.
- **Validation wording**: gender/phone/DOB messages shared by `new` and `new-v1` via `lib/patients/registration-schema.ts`; DOB label now marked required, matching validation. Zod 4 `error:` option is valid (zod ^4.4.3).
- **Stored data**: none changed; UI and form-validation only, no FHIR writes or schema changes.
- **Scope**: no sidebar/nav, composer, Lab/POCT or X-ray files touched; no secrets/.env in the diff; no clinic-scoping code touched.

## Finding (fixed)
- The PR made the low-stock banner depend on `orderSoon` only, so a clinic with only out-of-stock items got no banner, and the default selected medication ignored out-of-stock items. Fixed: banner and selection use `attention` (out-of-stock first, then order soon); the "more" link targets Out of stock if >5 are empty. Regression test added.

## Gate
Unit tests for this file 7/7 pass; `tsc --noEmit` clean. Full e2e `check-all.sh` not run (shared RAM with production; PR author also skipped). CI at review time: lint-and-build pending; Vercel failed due to a deployment rate limit (infrastructure, not code).
