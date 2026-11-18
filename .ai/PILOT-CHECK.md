# Task 558: pilot-readiness walk (2026-11-17)

Setup: origin/dev @ 620d0c8, ONE dev server (`next dev --webpack -p 3558`, 3072 MB heap), dev Medplum :8113, fake data only.
User: `doctor@ucc.local` (project member, **not admin / not super admin**). Note: in the dev project this member has no AccessPolicy
attached, so the walk proves the app flow as a non-admin, not AccessPolicy enforcement (that is `staff-membership.spec.ts` / Task 5).
Tools: Playwright (`e2e/tests/workflow.spec.ts`, `dispense-checkout-ui.spec.ts`) wrapped in `timeout`, plus a throwaway analytics reader.

## Walk result
| Step | Result |
|---|---|
| Register patient, check-in + vitals | PASS |
| Queue -> start consultation | PASS |
| Composer: diagnosis, med, services, lab, imaging, MC, referral | PASS (item kept without Firebase) |
| Sign | PASS |
| Lab result -> Lab tab only | PASS (appears in Labs & Imaging tab) |
| Documents tab | PASS: MC + Referral listed, Edit/Delete present |
| Checkout (total RM 125.50) -> Complete visitation | PASS: Invoice `balanced:125.5`, patient leaves queue |
| Dispense auto-deduct | PASS: Paracetamol 496 -> 495; `dispense-checkout-ui` 4/4 (no double deduct on reload/retry) |
| Page smoke (18 routes, non-admin) | PASS, no redirect loops |
| Time Chit | Walked in Task 605: PASS after one fix (blank letterhead race), see `.ai/research/task-605.md` |

## Bugs found
### Fixed in this PR
1. **Analytics revenue ignored quantity and lab/imaging lines** - `lib/analytics/compute.ts` (`sumItems`, was lines 25-33).
   Order prices are unit prices (`ORDER_PRICE_EXTENSION_URL = .../unit-price`, `lib/fhir/consultation-service.ts:72`) and checkout bills
   `quantity * price` (`checkout-client.tsx:1146`). Analytics summed raw `price`, and skipped `billingItems` (lab/imaging). Example: 4 x RM 2.50 counted as RM 2.50.
   Fix: `price * (quantity ?? 1)` plus `billingItems`; unit test `tests/unit/task558-analytics-revenue.test.ts`.
2. **Analytics dropped most consultations** - `app/(routes)/analytics/page.tsx` intersected the clinic-wide consultation read with the 300 most-recently-updated
   active patients (`getAllPatientsFromMedplum(300, ...)` line 38). Live: "Consultations this month" showed 225 while the clinic had ~1478 encounters this month, weekly
   chart/top diagnoses/revenue were equally undercounted, and numbers did not move for patients outside the newest 300 (also all archived patients).
   Fix: use the batched clinic-scoped read directly (it already filters by clinic identifier + `matchesClinic`). After: 1482.

### Open (not fixed; not clear/small, or already tracked)
3. Analytics "Revenue" = ordered lines on consultations, not invoiced/paid amounts (invoices are the source of truth after checkout). Recommend computing from Invoice totals; needs a product decision.
4. Analytics gender/age charts still use only the newest 300 patients (`page.tsx:38`) while "Total patients" is an exact count. Label or paginate. **Resolved (Task 564): charts are exact per-clinic _summary=count queries; see research/task-564.md.**
5. Consultation Fee is RM 0.00 on checkout (`patient-profile-workspace.tsx:80-84`, `unitPrice: 0`; bill-modal.tsx:154 as well). Clinic must set a price; no catalog-driven default.
6. Known probe (workflow test 11): `/api/labs/receive` returns 500 when `result.status` is omitted (Observation.status required) - should be 400 or defaulted. Lab/imaging orders also write Procedure `completed` at Sign.
7. No dedicated receipt view after completion: only a toast `Invoice INV-... was saved`, plus Bill preview/print before completing. Confirm with the clinic whether a post-payment receipt is required for the pilot.
8. Dev console noise (not user-visible): `503 POST /api/labs/subscription` when live subscriptions are unconfigured (`app/(routes)/api/labs/subscription/route.ts:55`); expected `404 GET /api/billing?consultationId=` before the invoice exists (`checkout-client.tsx:506`); `PatientDocuments` fetch abort on navigation (`components/patients/patient-documents.tsx:56`).
9. Medplum 5/min login limit makes repeated e2e logins return "Incorrect email or password" (known).

## Cleanup
Dev server (process group) and Playwright browsers were stopped; no changes to sidebar/nav, MC/Time Chit templates, or the composer.
