# Task 399 — independent review of Task 398 / PR #265

Reviewed 2026-11-16 in `/home/dev/ucc-task-399`, created from origin/dev e6c8278, then detached at PR head f8d8073. Worktree-local identity copied from that commit author. Explicit task authorization permits normal commits/pushes to the existing branch and a PR comment despite the generic AGENTS remote prohibition.

## Official references and code findings

- [Medplum 5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts): readResource accepts request options; no-cache bypasses cached reads; extended headers expose account metadata. Installed SDK is 5.1.13; verify compatible exports locally, without dependency changes.
- [Medplum readResource reference](https://www.medplum.com/docs/sdk/core.medplumclient.readresource).
- [FHIR R4 REST](https://hl7.org/fhir/R4/http.html#read): deleted resources return 410, unknown IDs 404. Neither read failure may lead to a write or resurrection via PUT.
- [Next.js 16 route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route): PATCH/DELETE are server route handlers. Traced requireClinicAuth through caller clinic forwarding.
- [React 19 rules](https://react.dev/reference/rules/components-and-hooks-must-be-pure): no React/component changes in this appointment-service review.
- [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html): imaging web services are outside this diff; no DICOM/PACS changes.

The general resourceMatchesClinicTenant helper permits metadata compartment ownership without an identifier. The appointment mutation guard must require an explicit clinic identifier per the repository rule. A deleted read already prevents writes but its 410 currently reaches the route as 500; map it locally to NotFoundError. Existing identifier-only own-clinic tests already cover missing meta and must remain valid. Add absent identifier plus own compartment, undefined/null caller clinic, account variants, read failures, and missing/deleted resource regressions.

Validation scope: requested unit tests and tsc; do not run the broad check-all browser/build/clinic gate against this shared production VPS. No server, service connection, containers, environment/secrets copying or real data. Fake in-memory fixtures only. Full gate is not claimed.

## Results

- New cases before fixes: 48 pass / 6 fail (compartment-only ownership and deleted-resource response, each across three helpers).
- Fixed explicit clinic identifier requirement and local 410-to-404 mapping in commit 8535d05; normally pushed to the existing Task 398 branch.
- Full unit suite: 289 pass, 0 fail, 23 files, 1462 assertions. Targeted suite after restoring mutations: 54 pass, 0 fail, 241 assertions.
- Mutation sensitivity: remove explicit identifier requirement => 9 failures; bypass account check => 12 failures; remove deleted mapping => 3 failures. All temporary edits restored in a finally block. Logs outside git: /home/dev/task399-{before,unit,targeted}.log and task399-mutation-*.log.
- `NODE_OPTIONS=--max-old-space-size=3072 timeout --kill-after=10s 180s node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0. Log /home/dev/task399-tsc.log is empty.
- `git diff --check`: pass. Changed-file allowlist and private-key/GitHub/Google credential-signature scan: pass. Human diff inspection found no credentials or real patient data. No .env or e2e/.secrets files copied or staged.
- Only a dependency symlink to the existing node_modules was used (no install/update). No dev server was started; no process cleanup needed. No Medplum or other data service was accessed.
