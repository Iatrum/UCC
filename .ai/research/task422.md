# Task 422 — status of a foreign-clinic Observation update (404 vs 403)

## Finding
`e2e/tests/clinic-isolation.spec.ts` line ~173 does a **direct Medplum FHIR** `PUT /fhir/R4/Observation/<clinic-B id>` as a clinic-A staff member and expected 403. It gets **404**, identically on clean origin/dev (e6c8278). No UCC route or service is in that path, so no app code changed.

Reproduced on origin/dev with the dev Medplum (:8113) and a Next dev server on :3422: line 172 (own Observation, subject moved to a foreign patient) gives 403 and passes; line 173 (foreign id) gives 404.

## Why 404
The clinic staff AccessPolicy `criteria` is applied by Medplum as a SQL `WHERE` filter on the read used for the existing resource. A resource outside the caller's accounts therefore does not exist for that caller. This is already recorded in `.ai/DECISIONS.md` (D-isolation-1 Q1: other-clinic direct read **404**, never in search) and is asserted in the same spec by `visible()` (`allowed.length ? 404 : 403`). A PUT first loads the existing resource, so it fails the same way. 404 is also the existence-leak-safe answer.

## Rule (one, applied consistently)
1. **Resource addressed by id** (read, update, delete, path param) that is foreign or missing: **404**. Foreign is indistinguishable from missing.
2. **Caller-supplied patient/subject/performer reference in a payload** (create, or moving a resource to another patient) that is foreign or missing: **403**. App services collapse foreign and missing to the same forbidden outcome (`assertOrderClinic`, `assertEncounterInClinic`), so this is not an existence oracle either. Medplum's `writeConstraint` on the policy does the same for direct FHIR calls.
3. `handleRouteError` already maps `NotFoundError` / Medplum not-found to 404 and `ForbiddenError` / forbidden OperationOutcome to 403; nothing to change.

## Dependencies on open PRs
Checked 2026-11-16: #264 (write containment audit, 403 foreign patient), #265 (appointment update containment) and #267 (update-by-id containment) are all **open drafts, not merged**. This task is built on origin/dev and touches only the spec, a new unit test and this note, so it does not depend on them. Rule 2 is the #264 behaviour; rule 1 is what #265/#267 should use for id-addressed updates in the app layer. If #267 chooses 403 for a foreign id in an app route, it should be aligned to this rule. Files of draft PRs #251/#252 are untouched.

## Change
- Spec: expectation for the foreign-id PUT changed 403 -> 404, with comment.
- Unit: `tests/unit/task422-status-rule.test.ts` pins the rule (foreign and missing patient reference both forbidden and equal; route mapping 404 vs 403).
