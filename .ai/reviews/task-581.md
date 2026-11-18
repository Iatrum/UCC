# Review of Task 580 (PR #314)

Verdict: **APPROVE**. No fixes needed.

- Recent-consultations mapping: `getRecentConsultationsFromMedplum` (`lib/fhir/consultation-service.ts:1095`) and `buildSavedConsultation` fall back to `Encounter.subject` for `patientId`. The bulk child searches use `_count=BULK_CHILD_COUNT` (1000). The new test pins this.
- Clinic scoping unchanged: the Encounter search carries `identifier=clinic|<id>` and `matchesClinic` filters the results. The test checks that the other-clinic encounter is dropped. The diff touches no production code.
- Labs subscription finding: correct. `app/(routes)/api/labs/subscription/route.ts` returns 503 only from the inner catch around Subscription creation and `$get-ws-binding-token`. The same catch also covers an invalid binding response. Auth, module-gate and scope failures go through `handleRouteError` (401/403/400). The Lab tab polls, so the 503 is a designed fallback.
- Checks: new test passes. `bun test tests/unit` gives 677 pass, 0 fail. `tsc --noEmit` is clean.
- Mergeability: PR is MERGEABLE, base `dev`, and branch contains `origin/dev`.
- Nit (not changed): the note says Task 580 did not use e2e or curl, so the 503 cause is from code reading only.
