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
