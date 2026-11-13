# Task 140 — Time Chit implementation

Worktree: `/workspace/ucc-pr-time-chit`; branch: `ai/task-time-chit`; base: `origin/dev`.
Local Next port: 3214, heap cap 2560 MB. Medplum: localhost:8113, fake fixtures only.

## Milestone 1 — implementation in progress
- Created requested worktree and cherry-picked plan commits 7753143 and 5f228ef.
- Read plan, mockup and implementation code; official documentation links recorded in research.
- Added off-by-default module, catalog handling, attendance validation, clinical mutation gates,
  clinic identifiers/account stamps, composer form/preview, checkout PDF, historical HTML print/edit,
  and editable clinic template. No sidebar/navigation or POCT/X-ray feature edits.
- Initial lint/type verification in progress; focused e2e coverage next.
- User explicitly authorizes milestone pushes and draft PR, overriding AGENTS.md remote prohibition.
- User explicitly prohibits the full suite: do not run check-all.sh (it runs the full suite and build).
  Run lint, typecheck, relevant Time Chit + document/MC tests individually with outer timeouts.
- Milestone 1 checks: `bun run lint` passed (includes TypeScript lint config + clinic admin guard).
  Detached Next server started on 3214; `/login` returned HTTP 200. Standalone typecheck running.
