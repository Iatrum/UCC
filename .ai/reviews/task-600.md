# Task 600 — review of PR #318 (Task 599 security hardening)

Verdict: **APPROVE** (one lint nit fixed on the branch).

Checked on a fresh worktree of the PR branch, `origin/dev` merged (already up to date):
- Upgrades: same-major only (next/eslint-config-next 16.2.1 -> 16.4.5 in lockstep, undici, zod, tiptap minors). `bun install --frozen-lockfile` succeeds and leaves the tree clean, so the lockfile is consistent. `@grpc/grpc-js` override resolves to 1.9.16 for firestore, 1.14.5 for google-gax.
- `bun audit`: 5 left (2 high picomatch via eslint-config-next, dev-only, no patched release; uuid via firebase-admin moderate). Matches the PR notes.
- Headers: X-Frame-Options DENY matches CSP `frame-ancestors 'none'`. All in-app iframes use `srcDoc`, so framing is unaffected. The OHIF viewer opens in a new tab (`window.open`) and is never framed. `object-src 'none'` is safe: no `<object>`/`<embed>` in app code. `base-uri 'self'` is safe: no `<base>` in the code. connect-src/img-src/frame-src are unchanged, so Firebase Storage and Medplum are unaffected. CSP is otherwise untouched, so login and the composer are unaffected.
- Secrets: the diff only removes hardcoded credentials and moves them to env vars. Nothing added. Owner action: the removed password is still in git history, so rotate it.
- tsc clean. Unit tests: 734 pass. Lint on the changed files: 0 errors; 1 unused eslint-disable warning, removed in this review.
- Not run: browser/runtime check (I relied on the author's curl and login notes), and e2e check-all.
