# Independent review: Task 356 / PR #252

Date: 2026-11-16. PR: https://github.com/Iatrum/UCC/pull/252. Base: `dev` (`5aee691`). Submitted head: `efdca21`. Independent coverage commit: `aa16bdc`.

## Verdict

**No MAJOR code findings. Focused auth verification passes. HOLD full-gate sign-off:** the required check-all script cannot write its hardcoded `/workspace/ai-logs` outputs on this host. Its failure is infrastructure evidence, not a no-new-failures result. Keep the PR draft until that regression evidence is available.

## Evidence

- Reviewed the complete Task 356 production diff plus `app/api/auth/login/route.ts`, `lib/auth-medplum.tsx`, and the login page. The server translates upstream HTTP 429 into an explicit code; the provider serializes that code with retry seconds. Requiring the complete leading code preserves legitimate throttling while rejecting embedded status numbers, phrases, and longer unrelated code names.
- Wrong-password login returns HTTP 401 / `AUTH_CREDENTIALS` without reaching token exchange. Token transport rejection and HTTP 5xx return HTTP 503 / `AUTH_UNAVAILABLE`. Upstream token 429 remains HTTP 429 with retry metadata. Configuration/grant failures do not become password errors. Submitted route tests exercise these boundaries; independent added cases cover login-phase 429/500/502/503, no failure cookies, retry headers, one upstream request, and final classification.
- `NODE_OPTIONS=--max-old-space-size=3072 timeout --kill-after=10s 180s bun test tests/unit`: **178 pass, 0 fail**, 515 assertions across 18 files. Submitted head independently passed 174/174 before added coverage.
- `bun run lint`: **PASS**. Targeted ESLint for all changed TypeScript: **PASS**. `git diff --check`: **PASS**.
- `NODE_OPTIONS=--max-old-space-size=3072 NEXT_TELEMETRY_DISABLED=1 timeout --kill-after=15s 8m bun run build:ci`: **PASS**, Next.js 16.2.1 webpack compilation, TypeScript, and page generation.
- One timeout-wrapped Playwright test: **PASS (28.5 seconds)**. Real login page and provider displayed exactly the 27-second throttling notice, incorrect-password notice, and unavailable-server notice using controlled HTTP error responses. Then exactly one unmocked app login with the fake `doctor@ucc.local` account succeeded against dev Medplum `http://127.0.0.1:8113`, refreshed authenticated state, set an HttpOnly session cookie, and reached its redirect. The redirect destination was intercepted to avoid loading clinical pages. Error simulation did not induce live throttling or stop any backend. Browser traffic outside the isolated app was blocked; screenshots, traces, video, and persisted session state were disabled.
- `timeout --kill-after=10s 120s bash e2e/scripts/check-all.sh review-356`: **FAIL / infrastructure** (`mkdir: cannot create directory '/workspace': Permission denied`). Redirection failures prevent lint/build/browser/clinic steps from running; baseline comparison has no results file. No claim of full composer, Lab/POCT, clinic-regression coverage.

Local evidence and reproducible browser harness: `/home/dev/ai-logs/review-356/` (`unit-reviewed.log`, `lint.log`, `eslint.log`, `login-e2e.log`, `login.spec.ts`, `playwright.config.ts`, `check-all.log`, `build.log`). No secret values or patient payloads were printed or committed. Official source links and review reasoning: `.ai/research/task356-independent-review.md`.

## Scope and lifecycle

Only independent unit coverage and review/research/shared-memory documentation were added. No production-code fix was warranted. Composer, Lab/POCT, analyser behavior, clinic isolation, Firebase Storage, sidebar/navigation remain outside this diff. The one temporary review server on `127.0.0.1:3216` used the 3072 MB cap and its entire process group received SIGTERM after browser verification; port closure was verified. The pre-existing server on 3210 was untouched. No Docker commands, protected directory access, Supabase/Tradebot access, production endpoint probes, merge, or force push.

Normal milestone pushes update the existing Task 356 PR branch, explicitly authorized by the session. Commits carry `[skip ci]` because the branch-push workflow otherwise probes production routes; no workflow was dispatched. This means skipped CI cannot be counted as a successful regression gate.

## Live GitHub snapshot

After coverage push, refreshed at 2026-11-16 08:01 UTC: draft **true**, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`; Vercel deployment and Preview Comments successful. Conflict-free is distinct from full validation or readiness to merge. Refresh after the documentation push for the final live state.
