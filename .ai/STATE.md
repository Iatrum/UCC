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
- 11:02 Round 3 resume Task 6c: uncommitted edits found complete (route validation + extension filter). Next: Claude review.
- 11:03 Claude review call 1 FAILED: 'Not logged in' (needs user /login). Fallback reviewer: Codex.
- 11:03 Codex review (fallback) APPROVE, 0 MAJOR. Running gate task6c.
- 11:10 Gate task6c PASS: lint 0, build 0, e2e 22/23 (new baseline; only known-bug probes summary fails), clinics 0. Committed f6d41e0. Codex 5h 6% (reset 13:15 MYT), weekly 2% (reset Thu 5 Nov 00:08 MYT). Claude: 1 call, not logged in. Pushed; round done, stop.
- 11:45 Round 4 start. Codex 5h 6% (reset 13:15 MYT). Claude logged in OK (bash -lc).
- 12:05 Task 6a committed ce8836a (Claude build, Codex review CHANGES x2 -> fixed). Gate PASS 22/23. PR #210 (draft, ai/task-6a from origin/dev). NOTE: #209 already merged into dev (958ca03).
- 12:14 Task 6b committed (Codex build, Claude+Codex APPROVE). Gate PASS 22/23. PR #211. Codex 5h 11%.
- 12:16 Running: admin full e2e (Codex, e2e/tests/admin.spec.ts, findings /workspace/ai-logs/admin-e2e/FINDINGS.md) + Task 5 research (Codex).
- Per-task PR flow: worktree /workspace/ucc-pr-<id> from origin/dev, cherry-pick, keep dev's .ai files + append entry.
Sat Oct 31 12:43:53 +08 2026 Round 5 resume: 6d fix (invite URL + HealthcareService) uncommitted, reviewed; gating.
- 12:54 Task 6d committed (invite 500 fix) + admin e2e spec update. Gate task6d PASS 22/23; admin spec 21 WORKS 0 BROKEN 4 NOT PRESENT (role edit, settings save, API keys/revoke, user deactivate). PR ai/task-6d. Next: Task 5.
- 13:09 Task 5 committed (policy+script, containment FAILED due to superAdmin project; rolled back; decision in BACKLOG). Gate task5-r2 PASS 22/23 (task5 r1 = dev-server timeout flake). Next: U1.
- 13:09 U1 audit launched (Claude, /workspace/ai-logs/u1).
- 13:41 Round 6: admin e2e already done+committed (6d, PR #212). Task 5 PR #213. NEXT: U1 (audit was launched 13:09, check /workspace/ai-logs/u1); Task 5 containment blocked by superAdmin project (decision in BACKLOG).
- 13:55 Round 7: box was OOM (orphan tb-rel vitest workers 12GB, killed); U1 Claude run had produced nothing (killed). Medplum + dev server restarted. Next: Task 5 non-superAdmin retest.
- 14:05 Task 5 decision D20 (test in non-superAdmin project). Claude building task5b test script (/workspace/ai-logs/task5b). U1 audit relaunched (Claude, /workspace/ai-logs/u1/claude2.json).
- 14:10 U1 done: throwaway Playwright script /workspace/ai-logs/u1/audit.mjs, screenshots in /workspace/ai-logs/u1/shots (desktop full pass 23 pages, tablet partial — dashboard+patients-list only, script hit its own 240s shell timeout). Findings written to .ai/UX-FINDINGS.md (7 findings + scope note + top-5 quick wins): nav missing Dashboard/Patients/Orders links (high), dashboard auth/queue-loading race on cold load (high), POCT/PACS/Tasks/Records bare 404s (med), raw-HTML document template editor (med), DOB date-format mismatch (low), Orders/Billing naming mismatch (low), Appointments empty-state ambiguity (low). No app/lib edits (audit only). Next: re-run tablet pass for remaining pages + exercise composer/Labs tab live (needs a patient actually "waiting for consultation", none were in queue this pass).
- 14:12 U1 done: .ai/UX-FINDINGS.md (7 findings, top: sidebar missing Dashboard/Patients/Orders; dashboard Login flash + stuck 'Loading queue'). Task5b retest PASS 12/12 in non-superAdmin project; Codex review CHANGES (exit code, enforce context, cleanup try/finally, more paths). Next: task5b fix loop + U2a/U2b.
- 14:25 Task5b committed (23/23 PASS). U2a committed (sidebar). U2b (dashboard queue timeout) in stash@{0}. Gate u2a running (also covers task5b script, no app import).
- 14:35 Resume after interrupt. Claude session limit (resets 18:00 MYT) -> Codex builds. Gate u2a running (NOTE: another agent's task6e-fix1 gate in /workspace/ucc-pr-6e hits same dev server concurrently -> flake risk). Codex review: U2a APPROVE, U2b CHANGES (overlap race, unmount cleanup), task5b script CHANGES (auth ctx id match, teardown exit, fixture checks). U2b fixing in worktree /workspace/ucc-u2b.
- 15:00 Task5b script fix (Codex) committed: 31/31 PASS exit 0, teardown clean. Gate blocked: another agent's ucc-pr-6e dev server now owns :3210 (+ its own gates), u2a gate result 15/23 INVALID (ran vs 6e code). Box near OOM (tradebot vitest).
- 15:05 Killed orphaned tradebot vitest workers (8.5GB, parent gone). Took back :3210 from idle ucc-pr-6e dev server (6e agent finished; its gate also 15/23 = env). Dev server now /workspace/iatrum-ucc. U2b committed 2a1d327. Running gate u2 (U2a+U2b).
- 15:12 PR #213 updated (pushed b2df4b8 to ai/task-5, body: root cause, 31/31 evidence, prod action for user). Gate u2 running.
