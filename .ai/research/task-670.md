# Task 670 - unit coverage round 5: billing, checkout auto-deduct, invoice totals, clinic scoping

Test-only. No dev server, no Playwright. Sources: repo code (lib/billing/*, lib/fhir/billing-service.ts,
lib/fhir/dispense-service.ts), Medplum 5.2.8 behaviour as already encoded in tests/unit/helpers/fake-medplum.ts
(If-Match as request header only, conditional create, _count/_offset paging).

## Coverage before -> after (bun test --coverage, lines)
- lib/billing/*: already 100%.
- billing-service.ts: 94.8% -> 97.3% (left: queue-failure branch 461-471 partly, 418)
- dispense-service.ts: 93.3% -> 98.3% (left: stale-claim takeover 293, 340-341, 395, 407)

## Added (tests/unit/task670-billing-dispense-coverage.test.ts, 23 tests)
searchAll paging/exact-multiple/runaway guard; dispensedUnits, readStock, name matching; same-medicine line
summing, non-Item lines ignored, negative stock reporting, restore on removed line + audit before/after,
retained deduction on unresolved line, clinic-scoped audit/reverse/deduct; isOwnVersionOrClinicBump;
float-sum totals, 1-sen tolerance, overpayment, dispenseError path, 412 retry (one invoice, one deduction),
non-conflict error not retried, superseded invoice does not deduct, cross-clinic visit/patient/stock.

## Findings
- No product bug found. All new tests passed against current code.
- Stale test fixed: task643 "void/delete of another clinic's invoice" expected /Access denied/, but Task 645
  deliberately returns NotFoundError("Invoice not found.") for foreign ids (no existence leak). Test updated.
- Pre-existing, unrelated failure left alone: `generateSlotsForSchedule > refuses a schedule that belongs to
  another clinic` (message is "Schedule unavailable in current clinic"). Scheduling, not in this task's scope.
- Not covered: stale-claim takeover (30 s) in dispense-service needs a clock-controlled fake; review follow-up
  failure path (billing-service 461-468).
