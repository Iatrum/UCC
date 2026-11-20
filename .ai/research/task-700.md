# Task 700 — Registration, queue and appointment unit coverage

- Next.js App Router route handlers use the Web Request and Response APIs. Invoke the exported handlers with NextRequest and inspect the actual response status and JSON. [Route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- Medplum accepts token searches in system-and-value form. Use fake clients to exercise the registration service, tenant resolution and persistence boundaries. The task references 5.2.8, while the worktree's AGENTS.md lists 5.2.15 for the dev server. The unit tests require neither server. [Medplum 5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [Medplum search](https://www.medplum.com/docs/search/basic-search)
- FHIR R4 Patient holds identifiers and demographics. Encounter records the visit, and Appointment records the booking and its cancelled status. UCC stores queue state in Encounter extensions. [Patient](https://hl7.org/fhir/R4/patient.html) · [Encounter](https://hl7.org/fhir/R4/encounter.html) · [Appointment](https://hl7.org/fhir/R4/appointment.html)
- The tests call HTTP handlers directly and require no React rendering. DICOM PS3.18 covers web services for imaging objects. These handlers have no imaging dependency. [React 19](https://react.dev/blog/2024/12/05/react-19) · [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/PS3.18.html)
- Task 639 already covers scheduling slots, appointment timestamp and rescheduling behavior, and queue service status mappings and check-in branches. Task 643 covers inventory and invoices. Task 482 tests generic foreign appointment mutations, and Task 456 tests individual registration form field schemas. This round exercises registration POST, the queue-to-triage handoff through the endpoints, and appointment create/cancel requests.

## Draft PR summary

Adds 16 fake-data unit tests for registration validation, same-clinic duplicate conflicts (current NRIC and legacy IC), cross-clinic registration outcomes, the queue and triage workflow, and appointment booking, reminders and cancellation. The registration tests verify the HTTP outcome and clinic attribution. The existing admin-client duplicate lookup searches by identifier before filtering its results by clinic.

The queue regression test reproduced HTTP 200 for an unknown status on an active visit. The status mapper fell through to the finish branch and could close the Encounter. The PATCH handler now returns HTTP 400 before mutation for unsupported values. Explicit null still clears the queue entry.

## Verification

- Base was the local `origin/dev` at `b22d32e`. The files in this change are disjoint from the diffs of the locally recorded PR #334 (Task 674) and PR #338 (Task 686) branches.
- Repository `tsc --noEmit --incremental false` and `bun run lint` passed. An extra check with the test included reached the repo's missing `bun:test` declarations and the existing `meta` typing errors in the shared Medplum test helper.
- `bun test tests/unit` reported 1,242 passed and one baseline failure. The untouched base reported 1,226 passed with the same failure. In `task639-scheduling-slots.test.ts`, the foreign-schedule guard returned “Schedule unavailable in current clinic” while the fixture expected “does not belong.”
- The full `check-all.sh` comparison remains unverified. Its documented comparison baseline at `/workspace/ai-logs/baseline/results.json` was unavailable. The unit tests needed no credentials, network or dev server.
