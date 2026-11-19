# Task 667 — PR #327 conflict resolution

PR #327 carries the Task 661 pilot walkthrough and cross-clinic denial evidence. The latest `dev` includes PRs #326 and #328. Merge `origin/dev` into `ai/task-661` and retain the independent pilot readiness findings and supporting evidence. Review both parents and the resulting PR diff before validation.

- [Git merge](https://git-scm.com/docs/git-merge#_how_to_resolve_conflicts) documents resolving and staging a three-way merge. [Git worktree](https://git-scm.com/docs/git-worktree) documents linked checkouts and per-worktree configuration.
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) and [React 19 release](https://react.dev/blog/2024/12/05/react-19) describe the App Router stack used for the pilot walk.
- [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) and [FHIR R4](https://hl7.org/fhir/R4/) provide the stack references for the existing isolation evidence. The branch's AGENTS.md records dev Medplum server 5.2.15. [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) provides the standard for web imaging services.

The only conflict was in the readiness table. A11 retains the Task 659 fix and links it to merged PR #326. A12 retains the Task 661 dev-only evidence and the production migration requirement. The Task 661 evidence files match the PR's original head byte for byte. The merged application and test files match `origin/dev`.

TypeScript, repository lint, changed-file ESLint and the PR diff whitespace check passed. The focused clinic isolation, console, and staging tests passed 30/30. The full unit suite passed 1,034/1,036 on both the merge result and `origin/dev` at `12df445`, with matching failures for cross-clinic invoice void/delete and cross-clinic schedule slot creation. Validation used the task's static and unit checks. The full browser gate was not run.
