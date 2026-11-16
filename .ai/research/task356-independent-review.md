# Task 356 independent review — 2026-11-16

Reviewed PR #252 at efdca21 against origin/dev 5aee691 in isolated worktree /home/dev/ucc-review-356. Local identity copied from the source checkout's last author. Explicit session instructions authorize normal milestone pushes to the existing branch, overriding AGENTS' default no-remote rule. No merge, PR creation, force push, production service access, clinical writes, or navigation changes.

## Official sources verified before review changes

- Medplum 5.2.8 [login source](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/auth/login.ts), [token source](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/token.ts), and [rate limits](https://www.medplum.com/docs/rate-limits). Login and token exchange are distinct failure boundaries; HTTP 429 must preserve explicit retry metadata.
- [Next.js 16 route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route): test the actual POST handler through NextRequest and Response, mock upstream transport.
- [React context](https://react.dev/reference/react/createContext): follow the actual provider's signIn error serialization through to the login page.
- [FHIR R4 REST](https://hl7.org/fhir/R4/http.html) and [DICOM Studies Service](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_10.html): no resource operations or DICOM changes required for this auth review.

## Findings and verification design

The changed classifier consumes the provider's explicit AUTH_RATE_LIMITED:<seconds>: message. Raw 429 text and longer code names must not create a throttling notice. Existing token catch/5xx handling already yields AUTH_UNAVAILABLE. Wrong-password responses remain AUTH_CREDENTIALS. No major defect identified in the production diff.

Added independent login-phase 429/500/502/503 route assertions, complementing submitted token-exchange coverage. Browser verification will exercise all three user-visible notices with controlled failures, then perform one real login using the fake dev account and local Medplum only. Disable traces/screenshots to avoid persisting credentials or sessions. Block browser requests outside the isolated app and dev Medplum; avoid clinical pages.

Port 3210 is occupied by another worktree; do not stop it. Use one temporary server on 3216 with NODE_OPTIONS=--max-old-space-size=3072; kill its entire process group at completion. Production-probing push workflow requires [skip ci] commits, as in the submitted branch. Full-gate limitations must be reported separately from focused checks.
