# Review of PR #271 (Task 422) — foreign-id update status

Reviewed head c149705 (base origin/dev e6c8278). Reviewer: Task 423.

## Verdict: REQUEST CHANGES (not mergeable as "rule applied consistently"; the spec fix itself is correct)

## Checks
| Check | Result |
|---|---|
| `bun test tests/unit` | 238 pass, 0 fail |
| `bun run lint` (tsc + clinic-admin check) | clean |
| Targeted e2e `clinic-isolation.spec.ts` | NOT RUN: available RAM 1.9 GB < 3.5 GB gate |
| Composer / sidebar / nav / POCT / Lab files touched | none (3 files: spec, new unit test, research note) |
| Secrets / real patient data | none; fake ids only |
| PR state | draft, MERGEABLE, base `dev` |

## Findings

1. **Rule 1 ("id-addressed foreign/missing -> 404") is not what the app does, and the PR note claims it is consistent.** The PR changes no app code, so the rule is only true for direct Medplum FHIR calls. App routes that address a resource by id:
   - `app/api/follow-up/[id]/route.ts` PATCH and DELETE (admin client): `readResource` then `ForbiddenError` for a foreign clinic. Foreign id -> **403**, nonexistent id -> **404**. This is an **existence oracle** across clinics, which is the leak the note says 404 prevents.
   - `app/api/tasks/[id]/route.ts` PATCH: same pattern (foreign 403, missing 404). Same oracle.
   - `app/(routes)/api/labs/results/route.ts`, `app/(routes)/api/imaging/results/route.ts`, `app/api/pacs/viewer/link/route.ts`: id (patientId/encounterId/imagingStudyId) addressed, foreign and missing both **403**. No oracle, but it contradicts rule 1 as worded.
   - `lib/fhir/inventory-service.ts` already follows rule 1 (404 for both). That is the model to copy.
   Fix options: (a) change follow-up and tasks routes to NotFoundError for foreign (preferred, closes the oracle), and align the lab/imaging/pacs ones or (b) narrow the wording of rule 1 to "direct FHIR calls" and file a backlog item for the app routes. Either way the oracle in follow-up/tasks should be fixed or tracked explicitly. Not a regression introduced by this PR.

2. **Tests do not fail when the fix is reverted at unit level.** The "fix" is a spec expectation change; `task422-status-rule.test.ts` exercises existing code (`assertPatientInClinic`, `handleRouteError`) that the PR did not touch, so it passes with or without the PR. Only the e2e spec distinguishes (reverting 404 -> 403 fails against a live dev Medplum; I could not run it here). The unit test is a reasonable pin of existing mapping but adds no coverage of a route returning 404 for a foreign id, which is exactly where finding 1 lives. Add a route-level unit test (follow-up/tasks with a foreign Communication/Task) once finding 1 is resolved.

3. Minor: the note's dependency paragraph says #267 "should be aligned" to this rule, but the already-merged follow-up/tasks routes contradict it. Update the note after resolving finding 1.

## Consistency / leak summary
- Direct FHIR (AccessPolicy): foreign id -> 404, foreign patient ref in payload -> 403; consistent, no leak.
- App routes: inconsistent (see finding 1); two have a foreign-vs-missing oracle.
- No composer, sidebar, nav, POCT/Lab behaviour change.
