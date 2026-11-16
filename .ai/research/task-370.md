# Task 370 — extended-account fixture compatibility

## Research

Read `.ai/REVIEW-int-360.md`, both receive-service implementations, `assertOrderInDeviceClinic`, `resolveClinicTenant`, the fixture and lint/gate scripts before editing. PR #245 head: b1977f5fa9506e23eb6e43bf50dc13cfffd16c63 (`ai/task-330-extended-header`). PR #236 head: 97d5b6ea09e5aabe6e279fa9d79b7637242e919b; already MERGED when inspected on 2026-11-16.

Official references:
- https://www.medplum.com/docs/sdk/core.medplumclient.searchone — returns a resource or undefined, matching the added fake search implementation.
- https://hl7.org/fhir/R4/healthcareservice.html — HealthcareService is distinct from Organization; this application's tenant account resolver uses HealthcareService.
- https://nextjs.org/docs/app/api-reference/cli/next — CLI reference; use repository lint script rather than a guessed CLI lint API.
- https://react.dev/versions — React 19 documentation. No React or Next application code changes needed.

Applied the exact report patch: HealthcareService account reference, fake Organization/HealthcareService search results, and fake authenticated clinic argument to both receive calls. Existing extended-header assertions retained; no clinic guard changes. Earlier JavaScript functions ignore the extra argument; #236 consumes it. Tests are excluded by the existing tsconfig.lint.json.

## Validation

All commands used NODE_OPTIONS=--max-old-space-size=3072; no Next server started, build, E2E, clinic query, secrets, production resources or patient data accessed.

- `/home/dev/ucc-245-fix`: patched #245 alone — `bun run test:unit`: 37 pass / 0 fail; `bun run lint`: exit 0.
- `/home/dev/ucc-370-merge`: real local merge of #236 + #245 with the identical fixture patch — 37 pass / 0 fail; lint exit 0. Merge commit f6d36acbfaf67bd1f9f0850d25bc3e90c002cb14, detached and never pushed. Sole conflict was historical `.ai/BACKLOG.md`; selected #245's resolved entry for this throwaway verification.
- Logs and exact patch: `/home/dev/ai-logs/task-370/{pr245-unit,pr245-lint,merged-unit,merged-lint}.log`, `fixture.patch`.
- `git diff --check`: pass.

The full check-all gate was not run: it builds and warms a Next server, runs browser workflows and inventories clinics. This task requested unit tests + lint and prohibited starting a server to keep RAM light. No full-gate PASS is claimed.

## Original Task 360 gate failures and main baseline limitation

The original integration gate remains FAIL (58/62). The report's retained comparison was an earlier broad Feedback run, not a controlled main/dev baseline. Fetched origin/main at 84874a7e4689744bf89efff2ffff6c1da22b8b6c (2026-06-02); none of these four e2e test files exists there. Absence of a test does not establish absence or presence of its underlying behavior. Pre-existing **on main is unverified for all four**; no main browser run was performed.

| Gate item | Evidence in report | Pre-existing on main? |
|---|---|---|
| POCT Lab subscription refresh/poll/unmount | Newly failing versus retained run; unchanged integration replay passed 1/1. Cause not established. | Unverified; test absent on main. |
| Staff membership CLI dry-run/apply/rollback | Failed previously; CLI unchanged across the reviewed stack; hard-coded /workspace backup path strongly implicated. | Unverified; test and CLI absent on main. |
| Time Chit toggle/composer/checkout/history | Failed previously (response timeout); no controlled-base attribution. | Unverified; test absent on main. |
| Workflow 11 known-bug probes summary | Existing expected failure; skipped in retained comparison. Generic lab/imaging orders become completed Procedures at Sign. | Unverified; test absent on main. |

Initial live #245 state: OPEN, non-draft, CONFLICTING / DIRTY against dev. The fixture repair does not resolve unrelated integration conflicts, and no dev merge is pushed.
