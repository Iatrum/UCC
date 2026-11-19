# Task 723 review of Task 722

Reviewed commit `f154ed1` against `aa19928` on PR #334. Task 722 changed one case in each of three specs. The diff adds no skips or Playwright retries and increases no navigation, assertion, or test timeout.

| Changed test | Review |
| --- | --- |
| `admin.spec.ts` · full local admin audit | The loopback check permits an isolated app port and keeps Medplum on the dev port. Moving audit evidence changes where artifacts are written. The Branches form renders **Save details** and **Save modules**, and both actions still require a successful PATCH and persisted state. The client form still requires the expected 400, error payload, and visible error. The accessible landmark and heading keep their visibility checks while excluding hidden streaming markup. Navigation now waits for DOM content with a 60-second cap (previously network idle with the configured 240-second cap). Earlier navigation readiness gives more opportunity for errors to arrive between audit steps, where the previous accounting could miss them. Task 723 carries browser errors forward to the next step, checks any remaining errors after closing the browser context, and verifies the exact destination URL. |
| `clinic-isolation.spec.ts` · clinic reassignment, multi-clinic reads, Provenance and Encounter stamping | The setup retries the platform-admin login once after HTTP 429. The app supplies a bounded integer `Retry-After`, and the test still requires HTTP 200 on the final attempt. Other status codes fail immediately. Clinic grants, forbidden reads and writes, reassignment, Provenance and Encounter assertions still run. The retry only addresses setup throttling and can add up to ten minutes to that prerequisite. |
| `poct.spec.ts` · online + Sign creates the active ServiceRequest and bill | The accessible patient link excludes hidden duplicate markup and still has to be visible. Task 723 scopes it to **Pending Tests** and asserts the owning patient's href. The active ServiceRequest, clinic identifier, analyser assignment, rejected offline sign, deduplication, billing, checkout and absence of a completed Procedure still have separate assertions. |

The app fixes in Task 722 address two genuine failures. The shared Input needs a client boundary to preserve its focus handler when rendered in an admin Server Component. The patient list service needs to pass unauthenticated Medplum outcomes to the route's 401 handler. The unchanged retained-session browser assertion requires 401 or 403 after deactivation.

Task 722's full-gate evidence shows zero new browser failures against its baseline and an overall gate failure from the separate clinic data audit. The known generic imaging workflow failure and two existing browser skips remain visible in that evidence.

## Verification

| Spec | Passed |
| --- | ---: |
| Admin | 1 |
| Clinic isolation | 1 |
| POCT | 8 |

The timeout-wrapped Playwright run passed all 10 tests with one worker, zero skips and zero retries. The admin audit recorded 24 successful checks and three existing coverage limitations, with zero broken checks. The repository's comparison script reports `passed 10/10` against the same three specs in Task 722's final gate report.

The isolated worktree reused Task 722's production build because this review changes only browser tests and notes. `free -m` reported 2,643 MiB available (138 MiB in the free column) at launch. The Next process group used the 3,072 MB Node heap cap and exited after the run. Port 3723 was confirmed closed. The tests used fake data in dev Medplum on port 8113.

Repository lint (including TypeScript), changed-file ESLint, and 28 focused unit tests passed. The full `check-all.sh` gate was outside this rerun. Its fresh Next build previously brought available host memory below 400 MiB on this shared VPS, and the focused run already exercised every test file changed by Task 722.
