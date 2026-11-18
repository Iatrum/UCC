# Task 599 — dependency audit + HTTP security headers

Sources: `bun audit` (GitHub advisory DB), Next.js docs (`headers()` in next.config, CSP guide), MDN CSP / Permissions-Policy, OWASP Secure Headers.

## 1. Dependency audit (bun 1.4.4)
Before: 144 advisories (6 critical, 69 high). After: 2 high, both `picomatch` (ReDoS, dev-only via eslint-config-next > tinyglobby; latest published 4.0.7 / 2.3.2 have no fix).

Changes (same-major only; no Next/React/Medplum major bumps):
- `next` 16.2.1 -> 16.4.5 (criticals: RCE in image optimisation / `use cache`, proxy bypasses, SSRF; fixed in >16.4.0). `eslint-config-next` kept in lockstep.
- `undici` 8.3.0 -> 8.12.4, `zod` -> 4.6.7.
- `@tiptap/{react,starter-kit,extension-placeholder}` -> ^3.34.0 (pulls prosemirror-view 1.42.x: paste XSS fix).
- `bun audit fix` (lockfile only): sharp, postcss, node-forge, websocket-driver (critical), js-yaml, nanoid, browserslist, protobufjs, form-data, brace-expansion, source-map-js, busboy, grpc-js 1.14.x, ...
- `overrides`: `@firebase/firestore>@grpc/grpc-js` ~1.9.16 (firebase pins ~1.9).

Left: picomatch (no patched release; dev tooling only). Re-run `bun audit` periodically.

## 2. Headers (next.config.js `headers()`)
Already present and enforced: HSTS, nosniff, Referrer-Policy, Permissions-Policy, CSP (incl. frame-ancestors 'none').
Added: `X-Frame-Options: DENY` (was SAMEORIGIN, contradicting frame-ancestors 'none'; all in-app iframes are srcDoc/blob previews), CSP `object-src 'none'` + `base-uri 'self'`, `poweredByHeader: false`.
Not added: report-only CSP (an enforcing one exists; removing unsafe-inline/eval needs nonces and risks Medplum/Next/Firebase); COOP/COEP (risk to OHIF launch/popups). OHIF nginx sets its own headers (infra/pacs-dev).
Unit test: tests/unit/security-headers.test.ts.

## 3. Secrets grep (values not recorded)
- `scripts/create-first-user.ts:25-26` hardcoded personal email + password (password also echoed) -> env `FIRST_USER_EMAIL/PASSWORD`, not printed.
- `scripts/create-medplum-client-credentials.sh:7-8,26` hardcoded email/password (echoed) -> env required.
- `scripts/create-medplum-client-app.sh:12` default email -> required env.
- Other hits are doc examples (`api/{labs,imaging}/receive/route.ts` comment curl), an e2e fake token, `.env.staging.example` placeholders: not secrets.
- **Owner action:** removed password/email remain in git history; rotate that password wherever reused. History not rewritten.

## 4. Verification
`bun run lint` clean, `bun test tests/unit` 734 pass, `next build --webpack` OK. `next start :3611` vs dev Medplum :8113 (fake data): headers confirmed by curl; login -> dashboard OK; patient page OK; consultation edit page Tiptap editor mounts and accepts typing; 0 CSP violations. Full e2e check-all not run (shared RAM). Order composer not exercised (no in-progress fake consult in queue); its CSP surface is unchanged. Server killed afterwards.
