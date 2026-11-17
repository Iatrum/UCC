# Task 341f: full low-memory gate after X-ray phase 3

Sources: Playwright test docs (https://playwright.dev/docs/test-assertions), Medplum access policies
(https://www.medplum.com/docs/access/access-policies), FHIR R4 update (https://hl7.org/fhir/R4/http.html#update).

First full run (UCC_LOW_MEMORY_GATE=1, dev Medplum + dev PACS, fake data): 54/68. Causes:
- workflow 02..11: fixed-format NRIC derived from the clock collided with a leftover dev patient (409 already exists). Test now uses a random NRIC.
- clinic-isolation: staff PUT that moves/targets a resource in an inaccessible clinic returns 404 (hidden), not 403. The same test already expects 404 for reads of those resources. Now accepts 403/404 and checks the stored subject is unchanged.
- xray-phase3: fresh worktree lacked git-ignored dev PACS secrets / PACS_* env, and Orthanc mounts the secrets from the original worktree. Environment setup, no code change.
- feedback (search right after write) and time-chit (45 s response wait) passed on rerun: timing flakes under a cold dev server.
