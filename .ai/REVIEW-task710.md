# Review: Task 710 (PR #344, docs-only perf measurements)

## Verdict
Approve. The PR only adds `.ai/research/task-710*` (6 files, +126, no code). The PR head (c94a935) sits directly on origin/dev (b22d32e), so "PR build" and "dev build" are the same code.

## Checks
- No UI change, identical data/totals, unchanged clinic scoping: confirmed, since `git diff origin/dev...c94a935` touches only `.ai/`.
- tsc --noEmit: pass. Lint and unit tests were not run, because no source changed.
- Independent re-measure: production build of the PR head in a fresh worktree, port 3747, dev Medplum, fake data. 3 interleaved blocks of 8 warm samples, using the same bench.cjs. Server killed afterwards.

## Re-measured (median of the 3 block medians; block medians in brackets; ms)
| Screen | Claimed (task 710) | Re-measured usable | Req / API (both) |
|---|---|---|---|
| Patients | 477 | 528 (476, 822, 528) | 91 / 4 |
| Appointments | 325 | 382 (355, 446, 382) | 69 / 3 |
| Analytics | 209 | 349 (486, 349, 215) | 51 / 2 |
| Orders | 278 | 274 (484, 252, 274) | 59 / 3 |
| Settings | 217 | 268 (456, 229, 268) | 59 / 3 |

Request counts match the claims exactly. Timings are noisier on the shared VPS (one block ran 1.5-2x slower), but the screen ordering and the conclusion hold: Patients is the slowest, all screens are roughly 0.2-0.5 s warm, and no single dominant cause was found. The claimed medians were from quiet runs and are a lower bound. Analytics in particular varies widely (156-625 ms).

## Findings
None requiring a code or doc fix. Note for readers: there is no before/after, because nothing changed. Treat the numbers as baseline, noise about +/-30%.
