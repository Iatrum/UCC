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
