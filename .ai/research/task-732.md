# Task 732 — CSRF allowed origins: host + known suffixes

Task 733 supersedes the origin policy described below. See [the review](../REVIEW-task732.md).

Follow-up to Task 720/721 (PR #347, merged). Replaces the per-deploy need to set CSRF_ALLOWED_ORIGINS.

Sources: OWASP CSRF Cheat Sheet ("Verifying origin with standard headers"); WHATWG URL spec (`URL.hostname` lowercases, default port is normalised to ""); MDN Origin / Sec-Fetch-Site.

Rule: allow if Origin host == request host (existing), OR https + no explicit port + hostname equals / ends with ".<suffix>" for drhidayat.com, iatrum.com, OR matches `^ucc(-[a-z0-9]+)*-hidayat0507s-projects.vercel.app$`, OR in CSRF_ALLOWED_ORIGINS.

Deviation from the brief: bare `*.vercel.app` is NOT allowed. Anyone can create `evil.vercel.app`, and the cookie-authenticated check would pass for it. Restricted to this team's scope. Residual risk: an attacker could name a project `ucc-hidayat0507s-projects` and get a matching host; Vercel previews of our own host already pass via the Host rule, so the pattern is only needed for cross-host calls and can be dropped if unused.

Trade-off: all clinic subdomains under drhidayat.com are now mutually trusted (previously sibling subdomains were rejected). Per-clinic isolation is still enforced by clinic identifiers/auth, not CSRF.

Note: current code has no Referer fallback; with no Origin it uses Sec-Fetch-Site only. Unchanged.
