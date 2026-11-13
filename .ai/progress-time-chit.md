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

## Milestone 2 — focused validation
- Standalone `npx tsc --noEmit` passed.
- Initial focused attempt found an incorrect test selector: composer search had no placeholder.
  Added an accessible name and updated the spec to use it.
- Evidence: `/workspace/iatrum-ucc-evidence/task-time-chit`.
- Composer generation and MC/referral forms passed; corrected the test's checkout transition:
  existing Sign saves and closes the panel (does not navigate). Test now waits for the clinical
  save, then explicitly opens the existing checkout route as staff would from Orders.
- Added boundary tests: 5 pass, 17 assertions (date/time/doctor validation, default off, escaping).
- Time Chit creation now fails before writes if clinic tenancy/account cannot be resolved.
