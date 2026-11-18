# Task 608: review of Task 607 (PR #309)

Verdict: **APPROVE** (one stale changelog sentence fixed on the branch).

Checked on a fresh worktree of `ai/task-556-staging-385d` (head 6048e84); `origin/dev` merged (already up to date).

- **Decision renumbering:** consistent. DECISIONS.md now has D46 (Task 358, checkout stock) and D47 (Task 5 topology), each once. The only references to the Task 5 decision (`PILOT-READINESS.md` rows 16 and 47) say D47. No other file references D46. The "D46" in `reviews/task-598.md` is the historical note about the duplicate.
- **Medplum version:** correct. `docker inspect ucc-dev-medplum` gives `medplum/medplum-server:5.2.15` and the dev `/healthcheck` returns `5.2.15-4d86215`. The new AGENTS.md wording separates the server (5.2.15) from the SDK (`@medplum/core ^5.1.13`, matches package.json). Old 5.2.8 mentions left in code comments and historical DECISIONS are accurate for when they were written. Production version is correctly left for the owner to check.
- **385c exception list:** safe. For a strict target (staging) any non-passed result (failed, timedOut, skipped, interrupted, missing status) must be an exact title in `e2e/staging-exceptions.json` (empty by default), a baseline match alone is not approval, and an unreadable or non-string-array list fails closed. Local runs keep the old lenient behaviour. Tests cover empty list, exact match (`"s "` rejected), bad JSON, non-string entries, missing baseline test.
- **Owner decisions:** the checklist says SSH tunnel only, no Tailscale for now (plan decision 2), with "`tailscale serve`, never `funnel`" if adopted later. Plan 1.8 still describes Tailscale as an optional step, which is consistent with that. Nothing touches production, DNS or Traefik.
- **Fixed:** the Task 607 CHANGELOG line claimed the Task 597 checklist was not found; it is `.ai/PILOT-READINESS.md`. Reworded.
- **Checks:** `bun test` staging-gate, staging-rehearsal, staging-exposure: 16 pass, 0 fail. `tsc --noEmit` clean. eslint on changed JS/TS files clean. No app code changed, so the composer and Lab/POCT rules are unaffected.
- Not run: the e2e gate against a real staging stack (does not exist yet).
