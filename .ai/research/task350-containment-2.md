# Task 350 — clinic containment, round 2

Closes the follow-ups left open in `.ai/REVIEW-containment.md` (Task 321) and `.ai/research/task320-write-containment.md`. Stacked on #243 (Task 320) and #244 (Task 321).

Facts relied on: Medplum AccessPolicy criteria do not gate `create` (Medplum access-policy docs, "Access Policies"); FHIR R4 `Encounter.subject` / `Observation.subject` carry the patient link.
Helpers reused: `assertPatientInClinic` (#243) -> `assertOrderClinic`.

## Changes
| Gap | Fix |
|---|---|
| `/api/scheduling/book`, `manual-book` | Routes already 404 on a foreign patient via `getPatientFromMedplum`. Service-level `assertPatientInClinic` is now the first statement of `bookSlotToAppointment` and `manualBookAppointmentWithSlot` (before `ensureClinicianSchedule` creates a Schedule). A foreign slot now throws forbidden, which gives 403 instead of a 500. |
| `updateConsultation` (`lib/models.ts`, `lib/models/consultation.ts`) | New optional `clinicId` argument. New `assertEncounterInClinic` **fails closed** (no clinic, bad id, missing or foreign encounter, or an encounter with no patient all give forbidden). `models/consultation.ts` returns `false`, `models.ts` throws. The Observation now carries `subject` and the clinic identifier. No callers exist today, so there is no behaviour change. |
| `/api/fhir/export` (Patient/Encounter graph) | Needs a clinic, asserts patient + encounter ownership (404 otherwise), and **re-uses** the existing Patient instead of `toFhirPatient`, which created an untagged duplicate. Mappers take an optional `clinicId` and stamp the clinic identifier. |
| `lib/fhir/export-consultation.ts` | Requires `clinicId` (else `success:false`, zero writes). Re-uses a Patient found by IC only if it belongs to the clinic. All created resources get the clinic identifier and account. |
| `/api/export-to-medplum` (bulk, secret-guarded) | Requires `clinicId` in the body (400), unknown clinic gives 404. Reads only Firebase consultations with `clinicId == X`. Same own-clinic Patient match and stamping. **Behaviour change:** Firebase docs without a `clinicId` field are no longer exported. |

New helper `makeClinicStamper` (write-containment.ts): resolves the tenant (throws if unknown) and stamps identifier plus `meta.accounts`.

## Tests
`tests/unit/write-containment-2.test.ts` (fake data, 8 tests). With the scheduling and `updateConsultation` guards removed, 2 tests fail.

## Not done
- No live e2e or `check-all.sh`: a dev server from another worktree was already on :3210 and the box was RAM-tight. The changes are service-level, with no `components/` change and no composer or nav change.
- `export-to-medplum` bulk route is unchanged for non-superadmin auth: it stays guarded by `MEDPLUM_BULK_EXPORT_SECRET`.
