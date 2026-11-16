# Task 360 integration review (in progress)

Base: origin/dev 7c42a6d21cf57494d39b682f8b3413ece93f0bd0. Integration branch int/360 remains local.

Recommended order: #236, #237, #238, #239, #240, #241, #242, #243, #244, #245. Dependencies: #236 → #240 → #241 and #243 → #244.

Local merges completed. One conflict: #245 .ai/BACKLOG.md, combined hunk @@ -20,4 -19,4 +20,8 @@, final historical extended-header paragraph. Use #245 resolved Task 330 entry, then retain #236 Task 180 Device-derived clinic containment and account-propagation evidence as an appended sentence. All other merges clean; no source conflict fixes.

Test results pending. No clean dev baseline exists on this host. No claim of no regressions is made at this checkpoint.

Confirmed integration regression (supplemental unit tests): combined suite 84 passed / 2 failed. Both failures are #245 `tests/unit/extended-accounts.test.ts` receive-path fixtures, lines 63–65 and 71–73: #236 added required deviceClinicId parameters to receiveImagingStudy/receiveLabResults; #245 calls the old signatures and receives ForbiddenError at clinic-tenancy.ts:287. #245 alone (b1977f5) passes all 3 tests. Update fixtures with fake-clinic-a, a matching HealthcareService account and tenant lookup; retain account-stamping assertions and never bypass the clinic guard. No PR branch modified. Full gate still running; lint passed.
