# Independent review: Task 357 — Orthanc + OHIF X-ray phase 3

## 2026-11-16 — HOLD: no committed review target

This is an intake verdict, not approval or a completed security review. Task 357's reported agent invocation exited with rc=76. No phase 3 draft PR, published branch, or implementation commit was found at review time.

Evidence:
- `ai/task-357-pacs` points to `52c2554` (the Task 350 containment merge), with zero commits ahead of `origin/dev` (`5aee691`, Task 355 merge).
- GitHub PR searches for Task 357 and Orthanc, plus the latest 80 PRs filtered for X-ray/PACS/OHIF/phase 3, contain earlier phases but no Task 357 draft.
- `git ls-remote --heads origin` filtered for Task 357, phase3, and PACS branches returned no matching published head.
- `/home/dev/ucc-task357` contains untracked `infra/` and `lib/pacs/viewer-token.ts`. The infrastructure filenames include compose, nginx/OHIF configuration, a webhook and synthetic-DICOM helpers. They were not copied, executed, committed, or treated as finished implementation. Their contents have not received an independent review.
- Review workspace: `/home/dev/ucc-review-357`, branch `ai/task-358-xray-phase3-review`, created from `origin/dev`; worktree-local identity copied from that base's last commit author.

## Requested checks

All five checks remain **unverified** for phase 3:

1. Production isolation: inspect committed compose/start scripts for a separate project, loopback-only published ports, dedicated volumes/networks, dev-only UCC/Medplum destinations, and no production paths or Docker socket mounts. Never execute the unfinished setup to infer safety.
2. Orthanc authentication: require authentication for REST and DICOMweb; reject absent/incorrect credentials and direct proxy bypasses. Keep archive credentials server-side. Verify DICOM ingress separately from HTTP authentication.
3. Accession matching: prove exact clinic/device-scoped order lookup, patient/encounter consistency, unambiguous accession handling, safe duplicate/retry behavior, and no writes on mismatch. Study Instance UID and accession are separate identifiers.
4. Clinic-scoped viewer access: authenticate the user, authorize the requested study against the active clinic, and enforce any token's clinic/study/expiry at image retrieval as well as link generation. A host allowlist alone does not authorize DICOM data access.
5. Tests: require fake-data positive and negative cases for auth, cross-clinic access, accession mismatch/ambiguity and replay, plus Lab-tab and composer regressions. Run the required gate against the finished implementation with local-only destinations.

No implementation MAJOR finding is asserted without a reviewable implementation. No speculative fix, stacked fix branch, or fix PR was created. Resume against a concrete Task 357 commit/PR; the current branch is documentation only and is not stacked on an implementation.

## Validation and boundaries

Repository/PR/ref inspection and documentation diff checks only. `e2e/scripts/check-all.sh` was inspected but not run: there is no phase 3 application change to exercise. No gate PASS or completion is claimed. No server, Playwright process, container, DICOM import, or Medplum write was started. Production services, protected paths, patient data, Supabase and Tradebot were not accessed. No secrets were copied or staged. Composer, Lab/POCT behavior, navigation, clinic logic and Firebase Storage are unchanged.

Research: `.ai/research/task-358-xray-phase3-review.md`.
