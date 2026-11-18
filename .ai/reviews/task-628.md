# Review of Task 627 / PR #318 (headers) — APPROVE

Scope: next.config.js header changes (+ quick look at rest of diff). No dev server run; static review, `bun test tests/unit/security-headers.test.ts` = 7 pass.

## Security
- Only tightening: `poweredByHeader:false`, XFO SAMEORIGIN->DENY (matches `frame-ancestors 'none'`), `object-src 'none'`, `base-uri 'self'`.
- No `unsafe-eval` added (pre-existing `unsafe-inline`/`unsafe-eval` unchanged; nonce CSP via proxy.ts remains a documented follow-up).
- Remaining broad `https:`/`wss:` in connect-src/img-src and dev `localhost:8103` are pre-existing; not regressions.

## Breakage
- Iframes: every `<iframe>` in app/components is `srcDoc` (no headers, inherits CSP) -> unaffected by XFO DENY. No `<object>/<embed>/<base>` in code, so `object-src 'none'`/`base-uri` safe. PDF preview uses srcDoc/blob + worker-src blob: (unchanged).
- Medplum: HTTP + ws origins still in connect-src. Firebase Storage: covered by `https:` in img/connect-src (unchanged).
- OHIF: opened via window.open top-level tab, never embedded; DENY/frame-ancestors do not affect it. If it is ever embedded, add its origin to frame-src.
- Camera permission kept `(self)`.

## Rest of diff (non-header, brief)
- Dependency bumps (next 16.4.5, tiptap 3.34.0, undici 8.12.4, zod 4.6.7) all exist on npm; lockfile updated. Not build-tested here.
- Twilio status lookup now filtered by category + clinic identifier, _count 200: sound.
- Hard-coded email/password removed from scripts. NOTE: they remain in git history; rotate that credential if it was ever real.

No changes pushed (nothing to fix).
