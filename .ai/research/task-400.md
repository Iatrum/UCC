# Task 400 — remaining update-by-id containment

2026-11-16. Base origin/dev e6c8278; isolated /home/dev/ucc-task-400,
branch ai/task-400-update-containment. Explicit task instructions authorize
normal milestone pushes and one draft PR, overriding the generic AGENTS remote
restriction; unit tests + tsc only override the general full-gate requirement.

## Research before implementation

- Medplum 5.2.8 official source: https://raw.githubusercontent.com/medplum/medplum/v5.2.8/packages/core/src/client.ts
  and SDK read/update references:
  https://www.medplum.com/docs/sdk/core.medplumclient.readresource
  https://www.medplum.com/docs/sdk/core.medplumclient.updateresource
  `readResource(type, id, options)` supports uncached reads; `updateResource`
  writes the supplied resource. Authorization must precede any mutation.
  Local installed SDK is 5.1.13 (package range ^5.1.13); no dependency changes.
- FHIR R4 REST: https://hl7.org/fhir/R4/http.html#read and
  https://hl7.org/fhir/R4/http.html#update — read and update address a resource ID;
  the ID itself is not evidence of clinic ownership.
- Next.js 16 App Router: https://nextjs.org/docs/app — existing route handlers
  resolve authenticated clinic context and route-helpers maps ForbiddenError to 403.
- React 19: https://react.dev/reference/react — no React/component changes needed.
- DICOM PS3.18: https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_1.html
  concerns DICOM web services; none of these helpers changes DICOM objects/services.

## Code findings and scope

Document updates can relabel foreign resources. Billing status derives clinic from
its target instead of its caller. Communication by-id status/open/send writes rely
on route checks, and referral checks are optional and throw plain Error.
`resourceMatchesClinicTenant` permits absent clinic context, so cannot alone be
used as a write authorization guard. Require a nonempty caller clinic and an
unambiguous matching `clinic` identifier before writing. Preserve identifiers,
metadata and existing field/status behavior. Read uncached with extended metadata.

Pass authenticated clinic from routes and input clinic through automatic send
callers. Guard Twilio send before network/config lookup or its error-status write.
The SID-search webhook `updateTwilioDeliveryStatus` is not UPDATE-by-id and has no
caller clinic; changing callback authentication is outside this task.
Appointment helpers (Task 398), delete/read/create helpers, composer, nav,
Lab/POCT behavior, Firebase Storage and infrastructure remain outside scope.

## Validation plan

Fake resource clients only. Direct helper tests for foreign ForbiddenError/403 and
zero writes, own-clinic success, absent/untagged/ambiguous ownership and billing
no-op. Run the foreign document test before implementing its guard to prove red.
Then all unit tests and NODE_OPTIONS=--max-old-space-size=3072 tsc --noEmit.
No dev server, Playwright, service access, secrets or production data.

## Results

- Red proof on unguarded base: `bun test tests/unit/task400-update-containment.test.ts --test-name-pattern 'document: foreign'`
  exited 1: expected ForbiddenError, received undefined (foreign update succeeded).
- Guarded focused suite: 18/18 pass, including foreign 403/zero writes and
  own-clinic document, billing, referral, status/open and Twilio send success.
  The send test replaces fetch with a synthetic response and restores fake config.
- Full `bun test tests/unit`: 253/253 pass (23 files).
- `NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/tsc --noEmit`: exit 0.
- No server, browser, build, container/service access, real patient data or secrets.
- Installed shared SDK is 5.1.13 (repo dependency); verified used API signatures
  against official 5.2.8 source as requested. No dependency changes.
- Symlinked existing node_modules read-only for execution; no environment/secrets copied.
- Self-review: all by-id communication send callers pass their input/authenticated
  clinic; ownership checks precede no-op returns, field mutation and network calls.
  Extended metadata survives updates; identifiers are never used to relabel foreign records.
  Missing/untagged/mixed clinic identifiers fail closed. No appointment helpers changed.
