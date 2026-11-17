# Task 401 — independent review of Task 400

2026-11-16. Review target PR #267, head b6b8254, base dev e6c8278.
Own detached worktree /home/dev/ucc-task-401 was created from origin/dev, then
checked out the review head. Identity is worktree-local, copied from that head's
last author. The explicit Task 401 push/comment instructions override AGENTS.md's
generic no-remote rule. No merge, force push, production or container access.

## Official references checked before changes

- [Medplum 5.2.8 SDK source](https://raw.githubusercontent.com/medplum/medplum/v5.2.8/packages/core/src/client.ts):
  readResource supports request options; no-cache bypasses cached resource reads;
  extended mode retains account metadata. Existing installed SDK is 5.1.13;
  no dependency changes planned.
- [FHIR R4 REST updates](https://hl7.org/fhir/R4/http.html#update):
  updates target stored resource IDs; ownership must be checked before writing.
- [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route):
  authenticated clinic context must be forwarded to service helpers. Reviewed
  existing App Router handlers and local ForbiddenError-to-403 mapping.
- [React reference](https://react.dev/reference/react): no component changes needed.
- [DICOM PS3.18 scope](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_1.html):
  these helpers do not implement or change DICOM services; PACS stays outside scope.

## Initial review findings

All six by-ID update helpers check stored clinic identifiers. Document, billing,
referral, status and opened tests exercise missing context, foreign/untagged/mixed
ownership and own-clinic updates. Referral missing clinicId is covered directly.
Billing checks before no-op returns. Call sites pass authenticated/input clinic.

One small containment issue remains in Twilio send: after checking the identifier,
the helper selects Organization settings using the redundant communication clinic
extension. A conflicting extension can read another clinic's settings. Use the
authorized caller clinic for this lookup and prove the issue with a failing test.
Existing Twilio denial coverage also needs missing/untagged/mixed ownership cases
and a fetch trap to prove rejection precedes network traffic.

Task 398 changes appointment-service.ts and appointments/route.ts, neither touched
by Task 400. Only shared BACKLOG append metadata overlaps; verify an in-memory
merge and combined unit suite without changing either branch's application scope.

Validation: synthetic clients and transport only, unit tests and capped standalone
tsc; no .env.local or secrets copied, no Next server or live service needed.
The full gate script was inspected: it builds and invokes live browser/clinic
fixtures, beyond this review's isolated checks. Its safety/prerequisites will be
reported explicitly rather than claiming a full gate pass.

## Results

- Before the settings fix, the three own-clinic send cases produced 1 pass and
  2 failures: foreign extension read clinic-b; absent extension read no Organization.
- After the fix, full unit suite 258/258 (23 Task 400 cases); standalone tsc and
  repository lint pass with the 3072 MB cap.
- Combined Task 398 overlay: 312/312 tests and standalone tsc pass. Original
  application/test bytes restored in finally; no appointment files retained.
- Initial merge-tree simulation found only the shared BACKLOG EOF append conflict.
  Relocated Task 400's unchanged entry to avoid it; final simulation is recorded
  in the PR comment. No branch merge is performed.
- File-path/credential-pattern checks and manual diff review pass; only synthetic
  config/fixtures. No service, server, browser or production access, no secrets
  copied. Full browser gate not run; see the review's explicit validation limit.
