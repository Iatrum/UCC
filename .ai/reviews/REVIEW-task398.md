# Task 399 review — Task 398 / PR #265

Reviewed 2026-11-16 against dev e6c8278. Original head f8d8073; reviewed fix head 8535d05. Verdict: scoped review passes after two fixes, both committed and normally pushed to the existing branch. No unresolved findings in the reviewed mutation paths.

## Findings fixed

1. **Clinic identifier fallback (major):** the generic resourceMatchesClinicTenant helper accepts matching compartment metadata even when the Appointment has no clinic identifier. That violates the explicit resource clinic ownership requirement. Reproduced with an untagged Appointment carrying `meta.compartment = Organization/fake-clinic-a`: all three mutations proceeded. The mutation guard now requires an explicit matching clinic identifier and rejects conflicting clinic identifiers; account checks still apply independently.
2. **Deleted resource response (minor):** an SDK Gone OperationOutcome prevented writes but became HTTP 500. The appointment guard now maps it to NotFoundError / HTTP 404. Unknown IDs retain their existing 404 mapping. No write or deleted-resource resurrection is attempted on either read error.

## Guard and caller review

- All three mutation helpers authorize themselves, including delete, rather than depending on route checks or restrictive fake access policies.
- Missing/empty/null/undefined caller clinic fails before reading. Foreign, absent, empty, mixed or conflicting resource clinic tags fail with ForbiddenError / 403 and zero writes. Metadata/compartment alone cannot replace a clinic tag.
- No-meta own-clinic Appointments remain supported by their explicit identifier; metadata absence alone does not grant ownership. Extended account metadata is explicitly requested on a no-cache read. Foreign/mixed accounts, including singular and array `meta.account` forms, are rejected even with the own clinic tag.
- PATCH and DELETE obtain clinicId from requireClinicAuth, which checks profile clinic assignment, and forward it into every mutation. Request body clinic values are not used. GET/create behavior is outside this mutation diff and unchanged.
- Own-clinic status/reschedule/delete paths succeed with and without account metadata. Tests verify one expected write, preserved identifiers/participants/comments/extensions/accounts, check-in timestamp, reschedule duration and cancelled-to-booked behavior.

## Validation

- Before fixes: added regressions produced **6 failures**, demonstrating both findings across all three helpers.
- `bun test tests/unit`: **289 passed, 0 failed**, 23 files, 1462 assertions, with NODE_OPTIONS capped at 3072 MB.
- Appointment suite: **54 passed, 0 failed**, 241 assertions. In-memory unrestricted fake client, only fake records; no AccessPolicy can hide a missing guard.
- Independent mutation checks: removing identifier requirement caused **9 failures**; bypassing account validation caused **12 failures**; removing deleted mapping caused **3 failures**. Restored source passes all 54 cases.
- `tsc --noEmit --incremental false`: **PASS**, exit 0, 3072 MB heap cap and 180-second timeout.
- `git diff --check`: **PASS**. Entire PR changed-file allowlist and credential-signature scan: **PASS**; human inspection found no secrets/real patient data. No environment or secret files staged.
- Full check-all/build/Playwright/clinic gate **not run**: this review uses the requested unit + TypeScript scope on the shared production VPS. Browser/live-server behavior is not claimed. Fake tests establish application guard behavior; they do not prove server AccessPolicies or atomic ownership checks under concurrent reassignment between read and write.

## Scope and operations

No composer/UI/navigation/sidebar, PACS/DICOM, Lab/POCT or Firebase Storage changes. No dev server, browser, production container, /opt/medplum, /root, Supabase, Tradebot, real patient records or Medplum data access. No merge, rebase, force-push or new PR. Explicit task instructions authorize normal pushes and this PR comment despite generic AGENTS remote restrictions.

Official reference links, research and detailed evidence: [.ai/research/task-399.md](../research/task-399.md). Live PR mergeability is rechecked after the final report push and recorded in the PR comment and user response; it may change as dev advances.
