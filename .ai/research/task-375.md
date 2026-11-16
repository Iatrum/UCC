# Task 375 — merge dev into PR #245

## Research and resolution

PR #245 head `deaa129b55a66885bc074ab12458355f2279e436`; fetched dev `52c2554048fcb59693050ac51dcdfe23f46f02ee` (includes #246 and #247). The repository fetch configuration tracks only dev, so the PR head was fetched with an explicit remote-tracking refspec before merging.

The PR head branch is already checked out in another worktree. Work proceeds in `/home/dev/ucc-245-merge` on isolated local `ai/task-375-245-merge`, starting at the exact PR head, with a normal push to `ai/task-330-extended-header` planned. No changes to existing worktrees.

Only conflict: `.ai/BACKLOG.md`. Keep Task 330's resolved extended-header entry and regression coverage, and dev's Task 180 authenticated Device clinic/identifier/account containment explanation and E2E reference. All dev application changes merge unchanged; PR regression tests and Task 370 fixture compatibility remain intact. No sidebar/navigation edits.

Read the receive service implementations, `assertOrderInDeviceClinic`, existing Task 370 research, regression fixture, package scripts, tsconfig files and full-gate script. Official references checked:

- https://www.medplum.com/docs/sdk/core.medplumclient.readresource — optional request options; existing per-request extended headers retained.
- https://hl7.org/fhir/R4/resource.html — FHIR R4 resource metadata; Medplum account metadata remains vendor-specific.
- https://nextjs.org/docs/app/api-reference/cli/next — use repository lint and standalone tsc; no Next server required.
- https://react.dev/versions — React 19 documentation; no React changes required.

## Validation

All validation uses `NODE_OPTIONS=--max-old-space-size=3072`, sequentially. Dependencies are reused through an ignored node_modules symlink; no install or shared dependency edits. Fake-data unit fixtures only; no Medplum connection or production access.

- `bun run test:unit`: 145 pass, 0 fail (16 files, 402 assertions).
- `./node_modules/.bin/tsc --noEmit --incremental false`: exit 0.
- `bun run lint` (tsconfig.lint + clinic-admin Medplum guard): exit 0.
- `git diff --check`: exit 0; no conflict markers remain.
- Compared final tree against fetched dev: no app/components/lib changes; the only test difference is PR #245's original extended-account regression fixture.

Logs: `/home/dev/ai-logs/task-375/`.

The full `e2e/scripts/check-all.sh` gate is not run: it invokes a build, server warmup, browser workflows and clinic queries, outside this task's requested unit/tsc/lint scope and low-memory/no-server constraints. No full-gate PASS claimed.
