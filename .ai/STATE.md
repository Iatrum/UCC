# STATE (updated by Dev each round)

Branch: `ai-work` (local only, from `dev` @ 85f6c4b). Never pushed.
Pre-existing local change kept untouched (NOT committed): `.claude/worktrees/agent-a639f69d` gitlink deleted in working tree; stray untracked file `ign toggle buttons…` left as is.

## Usage (round 1, 2026-10-31 ~03:00 MYT)
- Codex: read from `~/.codex/sessions/**/rollout-*.jsonl` -> last `rate_limits` (primary = 5h window, secondary = weekly). Start: 5h 0% (resets 07:56 MYT), weekly 0% (resets Thu 5 Nov 00:08 MYT).
- Claude: no headless % meter. Detect limits with `--output-format json` -> `is_error` + text "hit your limit"; track `total_cost_usd` per call as relative spend.
- Budget tonight: <= ~14% of weekly (1/7) per model, and stop at 30-40% of what remains in the 5h window.

## Round log
See bottom of file.

## Round log
- 03:00-03:46 Task 1 committed (ad24db1). Task 2 seed written by Codex, Claude review APPROVE; check-all task2 interrupted mid-e2e. Task 3 plan + Codex critique done (plan revised). Task 4 research done.
- 03:50 Resumed. Codex 5h 3% (reset 07:56 MYT), weekly 1%. Claude spend so far ~$1.29.
- 04:10 Task 2 committed. Gate: lint 0, build 0, e2e 20/23 (=baseline, after 1 flake rerun), clinics 0. Next: Task 3 build (Claude).
- 04:25 Task 3 built by Claude ($0.66). Gate + Codex review running.
- 04:55 Task 3 fix loop 1 done (Claude $0.59), Codex APPROVE. First gate: 05 PASS, 09 flake (paid amount 0, dev restarts). Re-running gate task3b.
- 04:58-05:15 Gate task3: lint 0, build 0, e2e 19/23 first run; only NEW FAIL = smoke "read endpoints" ECONNRESET (dev server hiccup) -> rerun PASS => 20/23 = baseline. clinics 0. Committed Task 3.
  - WARNING: probe 05 still FAILS functionally: POST /api/consultations/plan -> 503 persistenceAvailable:false, footer shows "Not saved to server…", but item is gone ("No line items yet"). Suspect: hydration useEffect deps [initialEntries, loadDraft, publishPlan(onPlanChange)] re-run on parent re-render and `publishPlan(initialEntries)` wipes entries. Not fixed (out of scope this round).
  - Screenshots: /workspace/ai-logs/task3/shots/before-composer.png (26 Oct, pre-fix), after-composer.png (this gate).
- NEXT (08:00 round): Task 3b = fix hydration wipe (run once per key / skip publish after user edits), verify probe 05 keeps "1 × RM 0.50". Then Task 4 (research in .ai/research/task4-labs-receive.md). Not pushed.
- 08:03 Round 2 start. Codex 5h window fresh (reset 07:56), weekly 1% (resets Thu 5 Nov 00:08 MYT). Claude OK (test call).
- 08:10 Task 3b: probe showed race (GET draft answers after first add). Plan -> Claude critique REVISE -> Codex built -> Claude CHANGES (1 MAJOR) -> Codex fix loop 1 -> Claude APPROVE. Gate task3b-r3 PASS (20/23, clinics 0), probe 05 now keeps item. Committed.
- 08:35-08:55 Task 4 (also covers /api/imaging/receive). Plan -> Claude critique REVISE -> Codex (high) built -> Dev + Claude APPROVE -> gate task4 PASS, e2e 21/23 (new baseline). Committed.
