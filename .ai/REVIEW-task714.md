# Task 715 review of Task 714

Reviewed local Task 714 commit `52d6664` against `origin/dev` at `b22d32e`. GitHub returned no Task 714 pull request by title or head branch, no matching remote branch, and no record for the full Task 714 commit SHA. The review is committed locally on `ai/task-715-review`. The requested same-PR push, comment, and mergeability check are blocked until the draft exists.

## Findings and fixes

- FHIR token search can return a resource tagged with both the active clinic and a second clinic. Follow-up settings accepted that Organization, document templates took the first search result, and the follow-up list only checked the legacy clinic extension. Those paths now require all clinic identifiers to match, following the existing update-by-ID ownership rule. Tests cover read fallback, zero writes on the ambiguous Organization, and exclusion of an ambiguous Communication from both the list and due processing.
- An explicit clinic setting of `manual` lost to the environment-wide Twilio default. The saved clinic mode now takes precedence, and an unset clinic still uses the environment default.
- The Task 714 admin-only saves are enforced at both settings routes. Clinic members retain read access, including template reads from the composer. The existing settings screens still show Save to members, with a 403 if they submit.
- Due processing now avoids resending queued messages on a later run. Overlapping requests can still race between selection and send. This pre-existing behavior is outside the sequential regression fix.

## Verification

The unchanged Task 714 test file passed all 13 cases. Each temporary mutation was applied on its own and restored:

| Mutation | Test that failed |
| --- | --- |
| Remove template save platform-admin check | Only an admin can save a valid template |
| Remove follow-up settings platform-admin check | Follow-up settings ignore a foreign Organization |
| Restore direct Organization lookup by clinic ID | Follow-up settings ignore a foreign Organization |
| Bypass the PACS clinic toggle | A saved clinic toggle gates the X-ray device route |
| Remove the clinic identifier check from either Organization lookup | Clinic settings reject an Organization tagged for two clinics |
| Remove the clinic identifier check from the follow-up list | Process-due queues only eligible records from the active clinic |
| Make the environment default take precedence over a saved manual mode | Saving manual delivery overrides a Twilio environment default |
| Remove the pending-delivery check | Process-due skips queued sends on the next run |

- `tsc --noEmit --incremental false`, `bun run lint`, ESLint on changed TypeScript files, and `git diff --check` passed.
- The focused tests passed 82 of 82. `bun test tests/unit` reported 1,241 passed and one failure. The same scheduling containment test, `generateSlotsForSchedule > refuses a schedule that belongs to another clinic`, failed on untouched `origin/dev` with 1,226 passes.
- Test processes were blocked from opening IP sockets and used in-memory fake Medplum records and mocked Twilio. Verification was limited to offline checks because the full `check-all.sh` gate requires live service calls.

## Suggested PR comment

Reviewed locally. Removing either settings admin guard or restoring the direct Organization lookup makes the corresponding test fail. Fixed acceptance of conflicting clinic tags and made a saved manual mode override the Twilio default. TypeScript and lint passed. The unit suite has the same single scheduling failure as `origin/dev`.
