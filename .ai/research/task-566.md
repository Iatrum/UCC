# Task 566 — /api/labs/receive 500 on missing result.status; Consultation Fee RM 0.00

## 1. /api/labs/receive
Evidence: `.ai/PILOT-CHECK.md` (PR #308/#310 branches), item 6 (workflow probe 11).
Cause: route only checked testCode/testName/value; `result.status` was cast `as any` into `Observation.status`
in `lib/fhir/lab-service.ts` (`receiveLabResults`), so Medplum rejected the Observation -> generic 500.
Also latent 500s: `performedAt` arrives as a JSON string but the service calls `.toISOString()`; malformed JSON body.

Decision: **400, no default.**
- FHIR R4 Observation.status is cardinality 1..1, required binding (registered | preliminary | final | amended | corrected | cancelled | entered-in-error | unknown). The spec gives no default. https://hl7.org/fhir/R4/observation.html
- `LabResult.status` in `lib/fhir/lab-constants.ts` is already non-optional in the analyser contract (preliminary|final|corrected|cancelled); the HL7/ASTM message route sets it itself.
- Defaulting to `final` would silently assert clinical finality of an analyser value; a wrong guess in a medical record is worse than a clear rejection.

Change: pure validator `lib/fhir/lab-receive-validation.ts` (testCode, testName, value finite number/non-empty string, status required + enum, interpretation enum, unit/referenceRange strings, performedAt ISO string -> Date). Route returns 400 with `results[i].field ...` message. Body parsed leniently so
**auth (`authenticateDeviceKey`) still runs first** (bad body w/o key still 401). Device-key auth, clinic scoping (`device.clinicId`) unchanged. No new POCT features; results remain Lab-tab only.
Tests: `tests/unit/task566-labs-receive-validation.test.ts`.

## 2. Consultation Fee RM 0.00 at checkout (code-only investigation)
Not changed. Two code paths:
- `app/(routes)/patients/[id]/patient-profile-workspace.tsx` (~L80): fallback catalog item `consultation-fee` with `unitPrice: 0`, added only when no catalog item name matches /\bconsultation\b/i (L322). So RM 0.00 appears when the clinic's procedure/service catalog has no priced "Consultation" entry.
- `components/billing/bill-modal.tsx` L31/156: `DEFAULT_CONSULTATION_FEE = 50` only when nothing billable; this is a different (bill preview) path.
Conclusion: missing fake-data/clinic config, not a logic bug. Fix = seed/create a "Consultation" service with a price in the dev clinic's catalog (Settings > catalog). A hardcoded non-zero default would invent prices across clinics, so no code change. Follow-up (optional, product decision): surface a warning when the fallback 0-price fee is used, or unify with the bill-modal default.
