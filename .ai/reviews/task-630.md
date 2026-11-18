# Review of Task 629 (PR #319) — APPROVE

- Diff: 2 test files + research note; **no app code changed**.
- Tests call real exported helpers (dispense-service, billing-service, checkout-guards, clinic-tenancy); the only stub is a throwing `readResource` to prove assertOrderClinic rejects before any read. No mocks-testing-mocks, no tautologies.
- Data: fake only (`clinic-a`, `inv-1`, example.test URLs).
- Deterministic: no clock/random/network; 3 repeated runs, 24 pass / 0 fail.
- Fixes pushed (small): `getInvoiceNumber` assertion tightened from `not.toBe("")` to the exact stored number; `assertOrderClinic` rejections now assert `OperationOutcomeError` (previously any rejection passed).
- Not covered / notes: composer, Lab/POCT rules untouched.
