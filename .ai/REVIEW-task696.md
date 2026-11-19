# Review of Task 696 (PR #339) — independent re-measure (Task 697)

Verdict: **approve.** Claimed gain confirmed (Documents tab ≈ −9 %), no data or behaviour change, composer unaffected. No code fixes needed.

## Method
Same as Task 696 (`.ai/research/task-696/bench.cjs`): production builds (`next build --webpack`) of base `b22d32e` and PR `c6ce1ec`, one
server at a time on :3697, 3 GB heap cap, dev Medplum :8113, fake data (fresh fake patient, 3 consultations with MC, 8 appointments,
queue check-in). 3 rounds × (1 discarded warm-up + 8 warm runs) = 24 warm runs per build; **order alternated per round**
(base,PR / PR,base / base,PR), server restarted and ~20 s rest between runs. Median of pooled runs.

## Results (usable ms, median of 24)
| Screen | Base | PR | Δ | LCP b/a (round medians) | Requests b/a | KB b/a |
|---|---|---|---|---|---|---|
| Profile, from queue (soft nav) | 409 | 421 | +12 (noise) | n/a | 22 / 10 | 45 / 37 |
| Profile, hard load | 406 | 419 | +13 (noise) | 464,364,432 / 444,388,448 | 68 / 56 | 29 / 20 |
| **Documents tab** | **751** | **680** | **−71 (−9 %)** | 416,384,380 / 404,428,376 | 67 / 62 | 24 / 21 |
| Inventory | 410 | 377 | −33 (noise; code unchanged) | 440,308,360 / 308,316,332 | 50 / 51 | 23 / 24 |
| Appointments | 419 | 408 | −11 (noise; code unchanged) | 80,64,64 / 68,76,72 | 71 / 71 | 36 / 36 |

Per-round Documents usable medians: base 756,715,779 → PR 708,739,679 (PR faster in 2 of 3 rounds, overall −9 %).
Conclusion matches the PR: only Documents moves beyond noise (±40 ms); the request-count drop on the profile (22 → 10 soft nav) is
real and deterministic but not visible as time on a 3-row history. The profile's +12/+13 ms is within noise, but means the profile
page is **not** measurably faster here; the PR body says the same.

## Correctness checks
- Diff read in full: only `{ includeMedicalHistory: false }` on the three GET-by-patient/referral reads, `prefetch={false}` on four
  Links, and a test. The returned patient is used only as an existence/clinic guard in those GET paths (`if (!patient) 404`), so no
  field is lost. `getPatientFromMedplum` still enforces the clinic identifier before returning. POST/PATCH/DELETE paths still use the full read (unchanged).
- Data unchanged: seeded one uploaded document + one referral for the fake patient, then compared `GET /api/documents?patientId` and
  `GET /api/referrals?patientId` JSON (sorted keys) on the base build vs the PR build → byte-identical (271 and 314 bytes). Unknown
  patient id → 404 on both. Also identical with empty lists (35 / 47 bytes). The new unit test also covers foreign-clinic → 404.
- No totals/billing/inventory code touched, so no totals can change; inventory/appointments pages differ only by noise.
- Composer: `e2e/tests/composer-plan.spec.ts` against the PR build: 5/5 pass (search while catalog pending, real plan save + reload,
  500 and 401 rejection keep the item, failed-save removal). Composer code is untouched by the diff. Lab/POCT behaviour untouched.
- Links with `prefetch={false}`: in a browser on the PR build, History → View lands on `/consultations/<id>`, back, Edit lands on
  `/consultations/<id>/edit`. Cost is on-demand render on click (expected).

## Notes
- Dev servers: base/PR on :3697 started and killed (whole process group) after each run; none left. Worktrees removed.
- Not a problem, but worth knowing: Playwright `request` fixture needs `UCC_BASE_URL=http://localhost:…` (the Secure session cookie
  is not sent to `http://127.0.0.1` by Playwright's request context → 401).
