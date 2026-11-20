# Task 712: double submit / slow-network retry of Sign and checkout

Question: can a double click, or a retry after a slow/timed-out response, create duplicate billing
Procedures, ChargeItems, Invoices, payments or inventory auto-deducts? Fake data / mock client only.

## Findings (code reading + unit tests)

| Path | Duplicate risk before | Verdict |
|---|---|---|
| `POST /api/billing` (checkout Bill/payment) | Invoice: `createResourceIfNoneExist` on consultation+clinic identifier, update with `If-Match`. Payment is fields on the Invoice (no separate resource). Stock: claim/If-Match protocol (Task 402, `dispense-service.ts`). Client: `isSubmittingRef` already guards the button. | **Not reproducible**: already idempotent. No change. |
| ChargeItem | App never creates `ChargeItem` resources (only reads `ChargeItemDefinition` catalog). | n/a |
| `POST /api/consultations` (consult Sign) | Always `createResource(Encounter)`; no key. Double click (state guard only) or retry after timeout where the first request finished server-side => a second Encounter + Observations + Condition + Provenance (a second visit that shows in history and checkout). | **Real**. Fixed. |
| `POST /api/orders` (treatment Sign: billing Procedures, MedicationRequests) | Sequential retry safe (dedupe by `procedureKey`/`prescriptionKey`). Two concurrent requests both read the same consultation, both pass the dedupe, and the replace path (delete all + recreate) can leave doubled Procedures/MedicationRequests. Client guard was state-only. | **Real but narrow (concurrent only)**. Fixed. |
| POCT / X-ray orders at treatment Sign | Already conditional-create keyed on draft entry id. | OK |
| Lab / non-POCT imaging order after `/api/orders` | Sent once after the orders write succeeds; a retry only re-sends if the first attempt never got that far. Not changed (out of scope: not billing). | noted |

## Fix
- Server: `POST /api/consultations` accepts optional `idempotencyKey` (`[A-Za-z0-9-]{8,64}`). The Encounter carries identifier
  `https://ucc.emr/consultation-sign-key | <clinic>:<key>` (no `|` inside the value: it is the FHIR token separator),
  created with `createResourceIfNoneExist` (FHIR conditional create, `If-None-Exist`). A repeat finds the Encounter and
  only creates children that are still missing (Observations by code, Condition, first-N-missing Procedures/MedicationRequests,
  Provenance). Same key + different patient => 409. Clinic is part of the key value, so keys never match across clinics.
  Requests without a key behave exactly as before.
- Server: `withSignLock` (in-process, per key) serialises same-key saves and the `/api/orders` POST read-merge-write per
  consultation. In-process only: it covers one Next server (our deployment); across instances the conditional create still
  protects the Encounter, the orders path relies on its existing dedupe.
- Client: synchronous `useRef` in-flight guards on consult Sign and treatment Sign (state alone can lag one render);
  `lib/sign-attempt-key.ts` keeps one key per (patient, note+diagnosis content) in sessionStorage, cleared on success; edited
  content gets a fresh key so new text is never dropped. No visual change.

## Verification
- `tests/unit/task712-double-submit.test.ts` (stateful mock client): concurrent+sequential same-key Sign => 1 Encounter,
  2 Procedures, 1 MedicationRequest, 1 Condition, 2 Observations, 1 Provenance; half-finished first attempt resumes without
  duplicates; different/no key unchanged; malformed key rejected; lock ordering; client key behaviour; wiring guards.
- `bun test tests/unit`: 1240 pass; 1 pre-existing failure (`generateSlotsForSchedule ... another clinic`), same on the base commit.
- `tsc --noEmit` clean.
- Playwright (throttled production build, `composer-plan.spec.ts`): NOT run. `free -m` "free" was 2300-2570 MB (< the 2500 MB
  gate, fluctuating) with production running on the same VPS. The composer request body only gains an optional field and
  requests without it are unchanged (unit-tested), but the e2e spec is unverified: run `e2e/scripts/check-all.sh` when RAM allows.
- Known limit: the resume path looks Provenance up with the caller's client; if an access policy hides it, a retry could add
  one extra audit Provenance (never billing data).

## References
- FHIR R4 conditional create (`If-None-Exist`): https://hl7.org/fhir/R4/http.html#ccreate
- FHIR R4 token search (`system|code`): https://hl7.org/fhir/R4/search.html#token
- Medplum `createResourceIfNoneExist`: https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist
