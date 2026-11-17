# Review: Task 491 (draft PRs #282 Task 476, #283 Task 486) — Task 492

Verdict: **APPROVE** (both). No code changes needed. Reviewed heads: #282 `284a431`, #283 `8800046`, both merged with dev `66f596b`.

| Check | #282 (ai/task-476) | #283 (ai/task-486) |
|---|---|---|
| Merge kept dev behaviour + PR changes | Yes: `git diff origin/dev...HEAD` is only the 11 PR files | Yes: only the 7 PR files |
| `bun test tests/unit` | 557 pass / 0 fail | 553 pass / 0 fail |
| `tsc` (`bun run lint`) | pass | pass |
| ESLint | 1 `react-hooks/set-state-in-effect` in `lab-results-view.tsx`, identical error already on dev (pre-existing) | clean on changed files |
| Composer unaffected | No composer files touched | `poct-section.tsx` only blanks the analyser name while loading; online gating unchanged |
| #283 adds no POCT features | n/a | Only `lib/poct-display.ts` labels (active→Pending) and date fallback (authoredOn→meta.lastUpdated) |
| Lab results only in Lab tab / no critical warning | Live-off hint is in the Lab tab only | n/a |
| Secrets / .env | None | None |
| Sidebar / nav | None | None |

Notes
- #282 live-status hint appears only after a subscription failure/drop; quiet when Lab features are off or on planned renewal (unit-tested).
- GitHub checks (lint-and-build, Vercel) were pending at review time. e2e not run (no dev server per task).
