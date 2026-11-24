# Review of Task 744 (PR #355) — Task 745

Verdict: **APPROVE (with one small test hardening added on the branch).**

## Checks
- **Real behaviour, not tautologies:** tests assert the written FHIR resource (identifier, account, trimmed values, dates), the search params, and zero writes on foreign/missing items. No snapshot tests. The only mocks are the fake Medplum client (the dependency) and `next/headers` (framework request context); the units under test are the real modules.
- **Mutation check (done by hand):** removing the clinic filter in catalog list, catalog update guard, catalog delete guard, appointment clinic list filter, or the 30-minute default each made a test fail. So the tests would catch a clinic-scoping regression.
- **Weak assertion fixed:** "refuses a patient outside the clinic" used `rejects.toBeDefined()`, which passes on any error (even a typo). Now it requires a `forbidden` OperationOutcome. Added a "no clinic id fails closed" case.
- **Coverage numbers are real:** `bun test tests/unit --coverage` → 1344 pass / 0 fail; catalog-service 100% funcs / 99.35% lines, appointment-service 100 / 98.77, server/clinic 100 / 100. Matches the PR notes.
- **Bug fixes:** none in this PR (tests and docs only, no production code changed). Nothing to judge for minimality.
- **Out of scope respected:** no composer, Lab/POCT, sidebar or Firebase changes.

## Notes (not blocking)
- `task744-server-clinic.test.ts` uses global `mock.module('next/headers')` and a `?task744` import query. Bun module mocks are process-wide; the full suite passes today, but a future test that needs the real `next/headers` could be affected.
- Test pins the cosmetic quirk that a code with a blank name stores `display: ''`.
