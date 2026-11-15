# Task 160 — U1b durable unsigned drafts

- Research complete; base origin/ai/task-u1b-save-state e66086d, depends on #234.
- Worktree /workspace/ucc-pr-u1b-draft, branch ai/task-u1b-draft.
- Decision: clinic/practitioner-scoped Medplum drafts, no clinical browser storage, retain Task 150 honest states.
- Implementation and validation pending. Local fake data only. Own dev server :3210; stop at completion.

## Implementation checkpoint
- Added preliminary Medplum DocumentReference draft service; authenticated clinic/patient/visit/practitioner scope, conditional create and version-pinned updates/cleanup. Treatment draft API contract retained; Firebase Storage untouched.
- Notes hydrate and autosave on the server; pending/failure/retry states and navigation/unload guards preserve Task 150 assurances. Signing waits for draft writes; cleanup failure is distinct from signing failure and offers cleanup retry without another Sign.
- Composer writes are queued; Sign waits for pending writes. Local-only/failed work prompts before panel loss/navigation. Reset guards after successful sign. Workspace keyed by clinic/patient.
- Added focused retention, isolation, failure/guard/cleanup tests and two security/lifecycle unit tests; updated Task 150 note assertion to the durable unsigned state.
- Lint/full tsc pass; unit 34/34. Initial focused suite 10/10. Combined rerun found stale test sessions and a stale post-sign guard; absolute ignored-session paths and guard reset fix those. Workflow checkout now passes; final workflow summary/full gate pending.
- Before/after screenshots saved in `.ai/ux-shots/u1b-draft/`.
- Test runner wraps Playwright/warmup in timeout 20m. No remote deployments, production, sidebar/nav or Lab/POCT changes.

## Pre-gate validation
- Latest retention spec: 4/4 PASS, including cleanup failure/retry without double signing. Tiptap's empty paragraph is normalized so cleanup does not recreate an empty draft.
- Task 150 save-state regression: 7/7 PASS. Multi-clinic Phase 2 integration PASS, now also verifies draft account inheritance, edits, cleanup and loss of access after clinic reassignment.
- Workflow rerun: 10/11 PASS (combined run 20/21), only baseline known-bug summary fails; checkout/navigation guard regression resolved.
- Lint/full tsc PASS; unit 34/34 PASS. Full gate pending; source freeze for that run.

## Final validation (2026-11-16)
- Single full gate: `e2e/scripts/check-all.sh task-u1b-draft-full` **OVERALL FAIL**, retained unchanged. Lint 0, production build 0, clinic inventory 0; e2e 47/51, zero skipped. Failures: baseline known-bug summary; analyser helper navigating before treatment signing finished; Time Chit fixture hard-coded to :3214; X-ray tab selection racing hydration.
- Corrected test assumptions only after the full run: device simulations wait for “Treatment Signed”; Time Chit uses required :3210 and explicitly confirms deliberate discard between local-only toggle cases; X-ray selects the tab and checks visible study content together. No application-source changes after the full gate.
- Focused POCT/Time Chit/X-ray replay: 12/13, then final X-ray simulation replay 1/1 PASS. All 13 affected tests now pass. No second full e2e run.
- Combined evidence: **50/51, zero skipped, baseline summary only**, comparator exit 0 against `/workspace/ai-logs/baseline/results.json`. This does not relabel the original full gate as PASS.
- Evidence: `/workspace/ai-logs/task-u1b-draft-full/summary.txt`; focused `/workspace/ai-logs/task-u1b-draft-recovery/reports/results.json`; final X-ray `/workspace/ai-logs/task-u1b-draft-xray-replay/reports/results.json`; combined `/workspace/ai-logs/task-u1b-draft/recovery-composite-results.json`; comparator `/workspace/ai-logs/task-u1b-draft/composite-compare.log`.
- Lint/full tsc PASS; unit **34/34**; retention **4/4**; Task 150 save-state **7/7**; Phase 2 draft containment integration PASS. Before/after screenshots committed.
- Own detached :3210 server stopped after testing; :8113 left running. No sub-agents. No production, Hostinger, Supabase, Tradebot or real patient data used. No secrets staged, no merges or force pushes.
- Deployment prerequisite: historical Firestore drafts are not migrated by this local-only change; plan that transition before deploying the new draft backend. Draft publication/live mergeability follows.

## Publication
Draft PR **https://github.com/Iatrum/UCC/pull/235**, `ai/task-u1b-draft` → `dev`, depends on #234. Initial live `gh pr view 235 --json mergeable,mergeStateStatus` returned **MERGEABLE / UNSTABLE** (checks; no merge conflict). Normal pushes only; no merge/force-push. Original full-gate FAIL and focused-recovery evidence are explicit in the PR body. Development server remains stopped.
