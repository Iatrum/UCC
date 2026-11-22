# Task 733 review of Task 732

Reviewed `20265a2` against `origin/dev` at `737cbd8`.

## Verdict

Approve with the fixes on the Task 732 branch. The focused security checks passed and the combined browser results show no new failures against the Task 722 baseline.

## Findings and fixes

- The suffix checks used dot boundaries correctly and rejected lookalike domains. They also granted automatic trust to every origin under both domains, including other clinic subdomains. Keep clinic and custom-domain saves same-origin and require exact `CSRF_ALLOWED_ORIGINS` entries for any intended cross-origin caller.
- Vercel's hostname format does not identify a particular deployment. Removing the pattern prevents other previews from acquiring blanket trust. The active preview still accepts saves made from its own origin using the public `Host` supplied by Vercel.
- The original Host check preferred an incoming `X-Forwarded-Host` and compared only the authority. The guard now ignores forwarded hosts, compares the request scheme, hostname and port, and checks that browser Fetch Metadata agrees when present. This path assumes the ingress preserves the public `Host`. Deployments that rewrite it can configure the exact public origin.
- Reject `Origin: null`, an empty Origin, URL paths, credentials, and other malformed values. Without Origin, allow same-origin Fetch Metadata. Block browser-simple POSTs that lack both headers. Headerless JSON POST, PUT, PATCH and DELETE remain available to API clients because browsers require a cross-origin preflight for these requests and the protected routes have no cross-origin CORS grant.
- Device, webhook and bulk-export routes retain their existing exemptions and route authentication. The consultation composer still sends relative API requests through the same Proxy.

## Verification

Focused tests cover clinic and preview saves, sibling and lookalike hosts, spoofed forwarded headers, scheme and port, exact configured origins, and missing or opaque origins. Research and source links are in [task-733.md](research/task-733.md).

- `bun run lint` passed, including `tsc --noEmit -p tsconfig.lint.json`. The production build also completed its TypeScript check.
- `bun run test:unit` passed all 1,342 tests across 118 files. ESLint passed for the changed TypeScript files.
- A timeout-bounded Chromium check against the local production build confirmed that an ordinary same-origin POST reached the intended route and a cross-origin form POST received HTTP 403 from Proxy. The fixture used a deliberately absent API route and no patient data.
- `e2e/scripts/check-all.sh task733` passed lint, build and the dev clinic audit. The raw Playwright run recorded 81 passes, five failures and 12 skips. Two clinic specs stopped at setup because they require a local env file. Time Chit and workflow login hit HTTP 429, and the registration case tried to log in with an existing session. The default run excluded the opt-in admin audit.
- Focused replays used the same build and fake dev data. Workflow passed all 11 cases, and clinic reassignment, Time Chit, registration and the opt-in admin audit each passed. The registration replay started with empty browser storage so it could exercise its intended login path.
- Staff membership passed after its replay used the gate's writable, private backup directory. The combined full and focused browser results were 97 passes and two baseline skips across 99 tests. The repository comparator exited 0. The original full gate remains recorded as a failed single run.
- All verification used the local app and fake data in dev Medplum. The local Next process groups exited and port 3210 was closed.
