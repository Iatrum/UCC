# Task 610 — review of Task 609 (PR #316): APPROVE

- Root cause: verified by reading code, not just the notes. `updateConsultationInMedplum` (lib/fhir/consultation-service.ts ~919) calls `signedDocumentMutationError`, which returns the "Signed documents cannot be edited..." error unless each signed note is resent unchanged or is a void transition -> `ConflictError` -> 409. The old spec PATCHed an edited unsigned `line()` after signing, so 409 is the intended Task 549 behaviour. The 409 is separate from the clinic and If-Match paths. I did not re-run the e2e or reproduce the server log.
- Change is spec-only for 609 (e2e/tests/time-chit.spec.ts). No app, clinic isolation or concurrency code changed, so neither is weakened. Other PR code (org letterhead fallback, Task 605) is covered by tests/unit/org-resolve.test.ts and was reviewed in Task 606.
- Coverage: spec now asserts unchanged resend -> 200, edit -> 409, and exactly one unchanged signed Time Chit remains. Immutability rule has unit tests (document-render.test.ts). GET returns `procedures[].notes`, matching the PATCH shape.
- Checks (merged origin/dev, already up to date): tsc clean, eslint on time-chit.spec.ts clean, bun test clinical-documents + org-resolve 25 pass.
- Not run: the Playwright e2e (needs dev server); no fixes were needed.
