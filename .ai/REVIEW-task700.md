# Task 700 coverage review

Reviewed `e1eed86` against local `origin/dev` at `b22d32e`.

The tests call the exported Next.js handlers with synthetic requests, run the real FHIR services and inspect the resulting resources and HTTP responses. The authentication spies supply a fixed clinic and the in-memory client records writes. The reminder failure test injects an error only when persisting the Communication, then checks that the Appointment still exists. The existing Task 482 suite covers foreign appointment mutations.

## Findings

- **Queue regression verified.** On `origin/dev`, an unknown string and a boolean both returned HTTP 200 and changed the active Encounter to `finished`. Task 700 returns HTTP 400 before writing for both inputs. Explicit null still clears the queue state and finishes the visit.
- **Triage lookup tightened.** Triage POST checked patient ownership by loading medical history it did not use, including a finished-Encounter query without a clinic identifier. The route now skips history for this ownership check. The regression test verifies that the Encounter searches carry the authenticated clinic identifier, that the foreign Encounter is untouched, and that the chief-complaint Observation is linked to the correct visit and clinic. A foreign-patient triage submission returns 404 without writing.
- **Registration isolation remains limited to the HTTP result and writes.** The existing privileged duplicate lookup fetches NRIC and legacy IC matches before filtering by clinic. The tests prove that a foreign match is never disclosed or modified and that registration stays in the authenticated clinic. The lookup still reads foreign matches. Tightening that query needs coverage for legacy patient ownership resolution in addition to the current identifier-based fixtures.

## Verification

- The 18 route cases passed under the pinned Next.js 16.4.5 dependency.
- The full unit suite reported 1,244 passed and one failure. The same foreign-schedule error-message assertion failed on the unchanged base, which reported 1,226 passed and one failure.
- The new triage regression test failed on the base because its workflow made an extra Encounter search.
- `check-all.sh task-701` passed lint, the production build and the dev clinic check. Its RAM guard stopped the browser batch and the script returned failure without a combined report. The documented baseline was unavailable.
- A separate Playwright run against the compiled app completed with 60 passed, 27 failed and 10 skipped. Registration, composer plan and Lab separation checks passed. The smoke test's only failing endpoint was `/api/health/deep` (503). The isolation spec stopped at the fake staff invite (500), before exercising access policy. The serial workflow stopped when its check-in assertion matched two dashboard rows.
- Against unchanged `origin/dev`, the smoke and isolation specs failed at those same assertions. The baseline workflow passed login, registration and check-in. A targeted review-branch retry with a unique synthetic fixture name also passed those three steps. The remaining browser failures were outside this targeted comparison.
- Local Git found no conflict against the cached `origin/dev` ref. The review commit is on `ai/task-701-review-task700`, which extends the Task 700 head and preserves its existing checkout. Repository rules prohibit remote operations, so GitHub PR status was not checked and this comment was not posted.

## Draft PR comment

Reviewed Task 700. The tests exercise the actual route and FHIR service code. Verified that invalid queue statuses closed the visit on `origin/dev` and now return 400 without writing. Added triage clinic-scope coverage and removed its unnecessary history lookup. All 18 route cases and the targeted registration and check-in browser retry passed. The full unit suite has the same foreign-schedule assertion failure as the base. The browser gate remains red. Registration still uses an admin duplicate query that filters by clinic after retrieval.
