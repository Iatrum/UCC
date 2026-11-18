# Task 629 — pilot critical-flow unit coverage map

Scope: tests only (fake data, no app-code change). Flow: registration → check-in/queue → triage → consultation sign → orders/composer → checkout (auto-deduct) → MC/Time Chit → invoice.

## Existing coverage (tests/unit)
| Step | Tests |
|---|---|
| Registration | task434-patient-counts (registration tag/month param), patient-dob, task478-patient-search |
| Check-in / queue | task480-dashboard-queue, triage-queue-pagination, task476-live-status-and-recent, task422-status-rule |
| Triage | triage-queue-pagination, task422-status-rule |
| Consultation sign / draft | consultation-draft, firestore-draft-migration, signed-document-audit, plan-save-state, task580-recent-consultations |
| Orders / composer | task482-order-mutation/route-containment, task566/572 labs receive, poct-*, write-containment*, task400-update-containment |
| Checkout / dispense | task458/504/519-checkout (totals, patient resolve, stock notice, invoice label), dispense-service, dispense-consistency (service flows with fake Medplum) |
| MC / Time Chit | clinical-documents, mc-diagnosis-shapes, document-render (shared letterhead/doctor/MMC), time-chit |
| Invoice | dispense-consistency (completeCheckoutInvoice/void/delete), task519 |

## Gaps (pure helpers on the path with no direct test)
1. `dispensedUnits` (ceil, zero/negative/NaN) — decides stock deducted.
2. `withStock` (copy-only, preserves strengths/other extensions) and `readStock` variants (valueInteger/String/Decimal, junk → 0, negatives).
3. `inventoryCandidates` / `matchInventoryItem` ambiguity + strength matching + unnamed catalog entries (only indirectly via service tests).
4. `isOwnVersionOrClinicBump` — concurrency guard for stock deduction; no direct test.
5. `getClinicIdentifierValue`, `withClinicIdentifier` (stamp, replace foreign, idempotent, no-clinic passthrough), full `resourceMatchesClinicTenant` branches (account/accounts/compartment/serviceProvider), `assertOrderClinic` early rejections.
6. `checkoutSubtotal` float/fractional/zero-mix edges.

Not re-tested: MC/Time Chit shared template mapping (already covered by document-render + time-chit); queue/triage (covered).

## Added
- tests/unit/task629-dispense-helpers.test.ts (1–3)
- tests/unit/task629-invoice-and-clinic-helpers.test.ts (4–6)

No real bug found; no tests skipped.

## Task 633 follow-up (next gaps closed)
Note: `.ai/reviews/task-630.md` does not exist on this branch; gap list taken from this file.
7. `normalizeTreatmentPlanEntry` / `computeTreatmentPlanSummary` (RM rounding, clamps, update-merge) — tests/unit/task633-treatment-plan.test.ts
8. `investigationBillItems` / `investigationBillingExtensions` (bad JSON / foreign ext filtering) and `lib/prescriptions` formatters — tests/unit/task633-investigation-billing-and-rx.test.ts
9. `lib/clinic-dates` follow-up/MC date arithmetic (month/year/leap, MYT rollover, invalid input) — tests/unit/task633-clinic-dates-followup.test.ts

Already covered elsewhere (not re-tested): time-chit guard (time-chit.test), appointment mutation containment.
Still untested: triage-service `updateQueueStatusForPatient`/`checkInPatientInTriage` status transitions (large mocked-Medplum surface), scheduling-service slot generation/booking, `updateAppointmentStatus` timestamp stamping, rescheduleAppointment status reset.

Suspected bug (skipped test): `mcEndDate(start, 0.5)` returns the day before start. Low risk (UI sends integers).

## Task 639 follow-up (remaining gaps closed)
Reusable helper: `tests/unit/helpers/mock-medplum.ts` (in-memory read/search/create/update/post + `tenantResources(clinic)`; no clock, sequential ids). Time-dependent code uses bun's `setSystemTime` with fixed ISO literals.
10. Triage queue transitions (`updateQueueStatusForPatient`, `checkInPatientInTriage`, legacy status fallback, foreign-clinic isolation) — tests/unit/task639-triage-queue-status.test.ts
11. Scheduling slot generation / `findSlots` / book / manual-book overlap rules — tests/unit/task639-scheduling-slots.test.ts
12. `updateAppointmentStatus` timestamp stamping and `rescheduleAppointment` end/status reset — tests/unit/task639-appointment-status.test.ts

Real bug found and fixed: slot/appointment end times were computed with server-local `Date#setMinutes`, which skews across a DST change when the server TZ has DST (reproduced with `TZ=America/New_York`, 2030-11-03: slot grid lost slots, reschedule end +90 min instead of +45). Production (Asia/Kuala_Lumpur) has no DST so it was latent. Fixed in `generateSlotsForSchedule`, `manualBookAppointmentWithSlot`, `saveAppointmentToMedplum`, `rescheduleAppointment` using absolute-ms arithmetic; regression tests fail without the fix.

Still untested: `getTriageQueueForToday` paging, `saveTriageEncounter` observations/vitals, `mcEndDate(start, 0.5)` suspected bug (above, unchanged).

