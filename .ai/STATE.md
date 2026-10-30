# STATE (updated by Dev each round)

Branch: `ai-work` (local only, from `dev` @ 85f6c4b). Never pushed.
Pre-existing local change kept untouched (NOT committed): `.claude/worktrees/agent-a639f69d` gitlink deleted in working tree; stray untracked file `ign toggle buttons…` left as is.

## Usage (round 1, 2026-10-31 ~03:00 MYT)
- Codex: read from `~/.codex/sessions/**/rollout-*.jsonl` -> last `rate_limits` (primary = 5h window, secondary = weekly). Start: 5h 0% (resets 07:56 MYT), weekly 0% (resets Thu 5 Nov 00:08 MYT).
- Claude: no headless % meter. Detect limits with `--output-format json` -> `is_error` + text "hit your limit"; track `total_cost_usd` per call as relative spend.
- Budget tonight: <= ~14% of weekly (1/7) per model, and stop at 30-40% of what remains in the 5h window.

## Round log
See bottom of file.
