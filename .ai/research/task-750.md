# Task 750 — feedback form security review
Files: components/feedback/feedback-control.tsx, app/api/feedback/route.ts, lib/feedback/{sanitize,service}.ts, proxy.ts, lib/security/csrf.ts, lib/rate-limit.ts.
Refs: GitHub REST create issue https://docs.github.com/en/rest/issues/issues#create-an-issue ; GitHub mentions https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#mentioning-people-and-teams ; OWASP CSRF cheat sheet.

| Check | Result |
|---|---|
| Auth | `getCurrentProfile` + `requireClinicAuth` first; module toggle -> 404 |
| CSRF | proxy matcher covers `/api/feedback`, not exempt, Origin check applies |
| Rate limit | per-user 5/min existed; added per-IP 30/min. In-memory, per server instance (existing limitation) |
| Size | UI maxLength 120/2000; server clips 120/2000/1500; body cap relied on Content-Length only -> FIXED (text length checked) |
| Markdown | mentions, HTML, bidi/control chars, fake headings -> FIXED (neutralise + fence) |
| Token | only in Authorization header server side; log prints status code only |
| Errors | shared `handleRouteError` echoes `error.message` on 500 -> route now returns fixed text |
| GitHub fetch | no timeout -> 8 s |
| Fallback | Basic record saved with sanitized text, clinic identifier; unchanged |

Not changed (needs decision): clinic id is written into the GitHub issue body (fine if repo is private); `handleRouteError` 500 echo is global;
rate limiter is per instance; `x-forwarded-for` trusted for IP key (spoofable if proxy does not overwrite it; Traefik does).
No real GitHub issue was created, no production Medplum read.
