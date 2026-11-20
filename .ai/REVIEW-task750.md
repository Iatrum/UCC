# Task 751 review of Task 750

Reviewed `d2fbb26d698a` on [PR #353](https://github.com/Iatrum/UCC/pull/353). The review is limited to the feedback changes in that commit.

- **Request size.** The original check read the entire body and counted UTF-16 code units. The route now reuses the bounded JSON reader and cancels the stream at 1,600,000 bytes. The cap still accommodates a 1 MB screenshot encoded as base64 with the form fields.
- **Rate limiting.** The per-clinic, per-profile bucket allows five requests, then returns 429 until the window resets. The separate IP bucket allows 30 requests and rejects the next one before authentication. Vercel provides the client IP on its platform header. Self-hosted ingress must append the direct client hop and keep the origin private. The in-memory fixed windows are best-effort per process, and the shared-IP bucket applies to staff behind the same NAT.
- **GitHub rendering.** The title uses a visible full-width character in place of a mention's ASCII at-sign. Raw HTML opening delimiters are neutralised. Description and error text render inside fences longer than any backtick run in the text. Joiners used in normal text and emoji are preserved. Issue readers must treat reporter text as untrusted.
- **Token handling.** The GitHub token is read server-side and added to the Authorization header. The issue payload, queued result and failure log omit it, including when the fetch error itself contains the token. The request has an eight-second timeout.
- **Normal feedback.** The tests exercise a successful clinic-scoped feature request, the bug issue hand-off and queue fallback, and screenshot validation. Invalid browser metadata types fall back to `unknown`.

## Verification

- TypeScript passed with `tsc --noEmit --incremental false`.
- ESLint passed for the Task 750 and Task 751 TypeScript files.
- All 26 feedback unit tests passed across `feedback.test.ts`, `task750-feedback-security.test.ts` and `task751-feedback-route.test.ts`.
- All eight tests for the shared device-ingress hardening passed.
- All three feedback Playwright tests passed against loopback dev Medplum. They cover the disabled module, normal feature submission and dedupe, and the queued bug with screenshot confirmation.
- The initial full gate passed lint, build and the four-clinic check. The browser suite passed 93 of 98 cases. The 45-second registration timeout waiting for the login email field reproduced both in isolation on the reviewed code and on the unmodified Task 750 head.
- After merging `origin/dev`, `e2e/scripts/check-all.sh task-751-merged` passed on `5abae1a`. The browser suite passed 95 of 99 cases, including registration and all feedback cases. The two failures and two skips match both local baselines.

The review found no remaining feedback blockers after the follow-up.
