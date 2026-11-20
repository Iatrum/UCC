# Task 744 — unit coverage for business-logic lib modules

Command: `bun test tests/unit --coverage` (Bun 1.4.4 built-in coverage; no external docs needed, FHIR behaviour exercised is already defined by the services).
Baseline: 1318 pass / 0 fail. After: 1344 pass / 0 fail.

| Module | Funcs before → after | Lines before → after |
|---|---|---|
| lib/fhir/catalog-service.ts (billing catalog) | 17.65 → 100.00 | 21.57 → 99.35 |
| lib/fhir/appointment-service.ts (scheduling) | 85.00 → 100.00 | 59.26 → 98.77 |
| lib/server/clinic.ts (clinic scoping) | 50.00 → 100.00 | 60.00 → 100.00 |

Skipped lower numbers (plumbing, not business logic): server/logging, admin-routes, medplum-admin, register-extensions, structure-definitions, poct/analyser-bot (POCT left alone), utils.

Tests: `tests/unit/task744-{catalog-service,appointment-service,server-clinic}.test.ts`. Uncovered leftovers: appointment-service 176-178 (error catch in patient list), catalog-service 197 (unreachable `!created.id`? only if Medplum returns no id).

Findings (no fix, not bugs):
- `getUpcomingAppointments` (unscoped, no clinic identifier) has no callers in app/lib/components; keep it unused (clinic-scoped variant exists).
- Creating a catalog item with a code but blank name stores `display: ''`. Cosmetic; the API validates names upstream.
