# REVIEW Task 4 (builder Codex high, reviewers Claude Sonnet + Dev = security)
- Plan critique (Claude): REVISE -> state proxy has no auth; normalise status once before DR status; mark body key as legacy; log clinic-isolation gap to backlog. Applied.
- Dev review: helper fails closed, SHA-256 + timingSafeEqual, header first, no key logged, 500s no longer leak error.message. curl: anon 401, wrong key 401, bad status 400, imaging anon 401.
- Claude security review: APPROVE, 0 BLOCKER/MAJOR. MINOR: e2e POCT_KEY silently '' if secret missing (accepted, local test only).
- Gate task4: lint 0, build 0, e2e 21/23 (was 20/23: security test now passes), clinics 0. Probe: lab result without status -> 200, DR final.
