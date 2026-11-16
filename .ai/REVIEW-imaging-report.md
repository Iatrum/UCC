# Independent review — Task 355 (`/api/imaging/report` auth), draft PR #249

Reviewed commit 19a945f (base origin/dev 52c2554). Read the route, `createImagingReport`, `authenticateDeviceKey`/`extractDeviceKey`, `assertOrderInDeviceClinic`, the unit test and the e2e spec. Re-ran `bun test tests/unit` (151 pass, 0 fail) and `tsc --noEmit` (clean). Did not re-run the e2e spec (needs the dev server; its logic was read only).

## Verdict: APPROVE — no MAJOR issues, no fix branch code needed

### Fail-closed behaviour (verified)
- Auth runs before any validation or Medplum read. No key, a malformed key (no `ucc_dk_` prefix), an unknown or revoked key, an inactive Device, a POCT-type key, or a legacy shared `PACS_API_KEY` all give 401. An unset `PACS_API_KEY` no longer matters because the env var is no longer read.
- A key that matches more than one Device is refused (`devices.length === 1`). A Device bound to zero or several clinics gets 403. A disabled PACS module for the Device's clinic gets 403.
- A bad JSON body gives 401 without a key and 400 with a valid key. Non-object bodies and arrays cannot bypass auth (`body?.apiKey` is only a fallback key source).
- `AuthError` maps to 401 and `ForbiddenError` to 403 before the generic 500 handler.

### Clinic scoping (verified)
- The clinic comes only from the authenticated Device. Nothing clinic-related is read from the body.
- The study AND its `basedOn` ServiceRequest must both carry the Device's clinic identifier, and their `meta.accounts` must match the tenant account. A study without a clinic stamp or an originating order, or one whose order belongs to another clinic (`is-mixed`), is refused.
- The report is stamped with the Device clinic and takes the study's account references, so it stays in the Lab tab's clinic-scoped subscription. No composer or POCT code is touched, and no critical-result warning is added.

### Tests
The 9 unit tests use the real route and real `authenticateDeviceKey` with a fake Medplum. They cover each 401/403/400 branch, all three key transports, and the positive path including the clinic stamp. I found no gaps worth blocking on.

### Minor / non-blocking (not fixed here)
1. `createImagingReport` still ends in the 500 handler for an unknown study id, and that response carries `details: error.message`. This only reaches an authenticated Device, but a Device can tell a nonexistent id (500) from an other-clinic id (403). Suggested follow-up: map not-found to 404 and drop `details`.
2. `getClinicIdentifierValue` takes the first `clinic` identifier. A resource with two clinic identifiers is judged by the first. This is a shared helper, equally true for `/receive`, and not a regression.
3. Only the first `ServiceRequest` in `imagingStudy.basedOn` is checked. Studies created by `/receive` have exactly one, so this is theoretical.
4. The `clinic-isolation.spec.ts` "Observation update authorization" failure is claimed to be pre-existing on origin/dev. I did not independently reproduce it.
