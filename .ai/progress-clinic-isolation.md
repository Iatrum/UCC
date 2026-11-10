# Progress — Task 090 clinic clinical isolation (Phase 0 + Phase 1)

Status: Phase 0 + Phase 1 implemented and verified 2026-11-10; draft PR #230 published; independent Claude review pending. Phase 2 not started.

## Plan
See `.ai/PLAN-clinic-isolation.md` phases 0-1, `.ai/research/clinic-isolation.md`, DECISIONS D33-D35.

## Checklist
- [x] Phase 0: disposable-identity script answering both questions (e2e evidence + research doc + decision) — PASS both, verdict D36: proceed to Phase 1. New write-side containment finding logged (BACKLOG, out of scope for Phase 1). Commit 73f9395.
- [x] Phase 1.1: Provenance added to UCC Clinic Staff Policy (setup-access-policies.ts). Commit 212a639.
- [x] Phase 1.2: createProvenanceForResource optional accounts param + all call sites. Commit a1e89b9.
- [x] Phase 1.3: triage-service.ts 3 update paths stamp meta.accounts. Commit c328809.
- [x] Phase 1.4: backfill-clinic-accounts.mjs (dry-run only, not applied) — written, dry-run verified against live local Medplum (checked=3955, alreadyStamped=3522, updated=433 would-stamp, unresolved=0). Found + fixed-in-script-only a real discovery: server strips meta.accounts/meta.account from every non-extended read (`X-Medplum: extended` header required) — without it the script saw alreadyStamped=0 (false). New BACKLOG/REVIEW finding: the APP's own `getResourceAccountReferences()` read-then-reuse call sites (imaging-service.ts receiveImagingStudy/createImagingReport, lab-service.ts's `accountRefs` for Observation/DiagnosticReport) read resources via the plain (non-extended) admin MedplumClient, so `accountRefs` is always empty in practice today -- those specific propagation calls (and my own Phase 1.2 Provenance-account-stamping at those same sites) are currently no-ops. NOT fixed here (requires SDK-level header support investigation, out of phase-1 scope) -- documented as a MAJOR in BACKLOG + will go in REVIEW-task-isolation-1.md. Committed f1d95b6 (already present at takeover).
- [x] Phase 1.5: actual function updatePractitionerInMedplum re-derives full multi-clinic access[], atomic with roles; explicit empty policy for zero clinics; admin and unrelated grants preserved. Lint PASS; live disposable e2e passed assignment union/revocation, custom grants, zero clinics and reassigning after zero clinics.
- [x] e2e: clinic-check.ts extended (433 historical missing / 0 invalid); clinic-isolation.spec.ts PASS (four disposable clinics, multi-clinic union/revocation/zero, Provenance, all three Encounter updates).
- [x] Gate task-isolation-1 ran once in foreground: initial OVERALL FAIL (cold composer compile / serial skips); unchanged-code workflow replay 10/11; composite 23/24, no new failures, comparator exit 0. Original gate evidence preserved.
- [x] REVIEW-task-isolation-1.md drafted (two deferred MAJOR findings, Phase 2 limitations; gate + focused recovery evidence recorded).
- [x] CHANGELOG + STATE updated with validation and task status.
- [x] worktree /workspace/ucc-pr-isolation-1, draft PR ai/task-isolation-1 -> dev: https://github.com/Iatrum/UCC/pull/230 (DRAFT, OPEN, live MERGEABLE; mergeStateStatus UNSTABLE at 15:39 MYT).

## Notes / findings log
- 2026-11-10: Resumed after two dead sessions (API connection errors, almost nothing committed). Confirmed env: Medplum :8113 up, dev :3210 up, only uncommitted WIP was a partial `lib/fhir/provenance-service.ts` edit — committed as part of Phase 1.2.
- Phase 0 script written: `scripts/access-policy/test-clinic-policy-superadmin.mjs`. Had to run `bun scripts/setup-access-policies.ts` first — the real "UCC Clinic Staff Policy" was missing from this project (local Medplum restore on 8 Nov predates/lost it); idempotent upsert, same as every environment's setup, not a data change.
- Phase 0 PASSED both questions (full writeup in research doc + D36). Bonus finding: write-side cross-clinic containment gap (staffA could POST an Observation onto another clinic's patient, 201 not 403) — documented, NOT fixed here (out of phase-1 scope), logged in BACKLOG + will go in REVIEW-task-isolation-1.md as a MAJOR.
- Phases 1.1-1.3 done and committed individually (one commit each, per AGENTS.md "small tasks, one commit each"). Lint clean after each (`bun run lint`).
- Phase 1.4: wrote + dry-ran `scripts/access-policy/backfill-clinic-accounts.mjs`. Discovered and worked around the extended-mode read gap (see checklist above) within the script itself (adds `X-Medplum: extended` header on every request). Decided NOT to also fix the app's own `getResourceAccountReferences` call sites in this task — that's a second, independent, SDK-level fix beyond phase 1's plumbing scope; documented instead.
- Complete: draft PR #230 published and live mergeability recorded. Independent Claude review pending; no backfill applied.

- Codex takeover: Phase 1.4 was already committed (f1d95b6), preserved. Phase 1.5 implemented and lint passed. Focused test reached Encounter checks after passing clinic access and Provenance; corrected legacy fixture to include the triage extension so save reuses the original Encounter rather than creating a new visit. No app stamping defect found. Full gate not yet run.

- Focused run PASS (1/1, 5.7s). Empty deny policy is validated before use so a same-name policy with grants fails closed. Historical inventory remains report-only until Phase 2; strict mode available.

- Milestones committed: 36a9f88 (Phase 1.5, including fail-closed validation of empty policy), 532b46b (focused isolation e2e and extended inventory). Final gate `task-isolation-1` started in the foreground, no background command and no second dev server.

- Final verification: single full gate failed at a fixed 15s composer wait while dev was still compiling; focused serial workflow replay without code changes passed all functional tests (10/11, baseline summary only). Composite original API/isolation + replay = 23/24, comparator exit 0. See REVIEW and `/workspace/ai-logs/task-isolation-1/RECOVERY.md`; do not claim a clean full-gate PASS.
- Dev-based worktree created at `/workspace/ucc-pr-isolation-1`, branch `ai/task-isolation-1`; cherry-picked Task 080 documentation prerequisite and Task 090 milestones only. Shared-note conflicts resolved by preserving dev notes and appending task entries. Integration lint PASS.

- Publication complete: normal push, one draft PR #230, base dev; live MERGEABLE / UNSTABLE at 2026-11-10T15:39:40+08:00. No merge. Unrelated root working-tree files left untouched.
