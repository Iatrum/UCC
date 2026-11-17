# Task 356 — auth 6b follow-ups

## Scope and prior work (2026-11-16)
- Isolated worktree `/home/dev/ucc-task356`, branch `ai/task-356-auth-6b`, based directly on fetched `origin/dev` at `5aee691`.
- GitHub open-PR check before edits: only #248 (Firestore draft migration) returned; search for Task 352 returned no PR. Task 352's local `ai/task5-clinic-policy` diff does not touch `lib/auth-errors.ts` or `app/api/auth/login/route.ts`. No stacking or topology changes.
- [Task 310 PR #242](https://github.com/Iatrum/UCC/pull/242) already moved classification into `lib/auth-errors.ts` and added token-exchange fetch rejection / HTTP 5xx → `AUTH_UNAVAILABLE` (503). Preserve that route and add regression tests rather than duplicate the fix.
- Remaining classifier gap: `startsWith('auth_rate_limited')` accepts longer, unrelated codes; raw status/text fallbacks can misclassify unrelated messages. Match the complete code at the start, followed by `:` or end. The login client already transports structured server codes into this string format. Keep retry default/clamp and other classifiers.

## Official references checked
- [Medplum v5.2.8 login source](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/auth/login.ts) and [token source](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/token.ts): authorization-code login and token exchange are separate requests; a transport failure after successful login is not a rejected password.
- [Medplum rate limits](https://www.medplum.com/docs/rate-limits): throttling is represented by HTTP 429; the app route translates it to its explicit `AUTH_RATE_LIMITED` code and retry metadata.
- [Next.js 16 route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route): POST accepts a request and returns a Response; exercise the actual route with mocked fetch, no server necessary for unit tests.
- [React context](https://react.dev/reference/react/createContext): provider behavior unchanged; test the existing extracted pure classifier.
- [FHIR R4 HTTP](https://hl7.org/fhir/R4/http.html) and [DICOM PS3.18 Studies Service](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_10.html): no clinical or imaging operations needed for this auth-only change.

## Validation plan
Exact code/delimiter, unrelated embedded codes/status/phrases, retry bounds, credential preservation; actual login POST with mocked successful login then rejected token fetch, token 5xx/429/invalid grant and wrong password. All fake data, no network in unit tests. Run full unit suite and lint; attempt required check-all with temporary host-path adaptations, record baseline and infrastructure limits honestly. No production services, Firebase, composer, navigation or clinic logic changes.

## Validation results
- Before the classifier fix: four new cases failed (raw 429, unrelated throttle phrase, two longer code names), establishing regression coverage.
- Focused auth tests: 30 pass, 0 fail. Route tests mock all fetches and assert HTTP status, public code/message, retry headers, no session cookie on failure, and client classification.
- Full `bun test tests/unit`: 174 pass, 0 fail (18 files).
- `bun run lint`: PASS. Targeted ESLint on all changed TypeScript: PASS. `git diff --check`: PASS.
- Required `check-all.sh` gate: orchestration refused to start because port 3210 was taken by the concurrent Task 352 worktree `/home/dev/ucc-task5-policy-20261116`. No existing process was stopped and no second server started. Temporary host-path/trace adaptations were restored immediately. Browser regression / no-new-failures criterion remains unverified; do not treat the unit results as a full-gate PASS.
- Standalone `NODE_OPTIONS=--max-old-space-size=3072 timeout --kill-after=15s 8m bun run build:ci`: PASS (Next.js 16.2.1 webpack, including TypeScript and page generation). Evidence: `/home/dev/ai-logs/task356/`.

## Review
One production file changes: remove raw status/phrase fallbacks and require the complete leading `AUTH_RATE_LIMITED` code plus delimiter/end. The server route, auth topology, client transport, clinic assignment and session cookies are unchanged. `signIn` already serializes server rate limits as `AUTH_RATE_LIMITED:<seconds>: ...`, so legitimate throttling still preserves the wait duration. Token exchange already returns 503 for fetch rejections and upstream 5xx in the base; the new tests protect that behavior. No outstanding code finding in this scoped self-review; no separate reviewer was delegated.

The Task 356 instruction explicitly requests normal push plus one draft PR as an exception to the standing AGENTS no-remote rule. Never merge or force-push.

## Publication safeguard
`.github/workflows/credential-check.yml` runs production route probes on every branch push. Use `[skip ci]` in this sole task commit to prevent those production requests without changing workflow configuration. [GitHub's documented skip behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs) also skips the PR workflow; required checks may remain pending. The draft must retain this validation limitation until a safe full gate / CI path is available. No workflow dispatched or production endpoint contacted.
