# Review of Task 556 (PR #309, 385d rehearsal proxy)
Verdict: APPROVE (after one small fix on the branch).
- Matches plan 385d: loopback-only, pinned image, file provider (no Docker socket), API off, allowlist routing; names/network match `infra/staging/docker-compose.yml`.
- Fails closed: unpinned/`latest` tag refused, staging network and MemAvailable checked, probe refuses non-staging bases and fails when the proxy is down (000 is neither allow nor deny).
- No secrets/.env in the diff; no app code or production path touched.
- Fixed: probe `curl` now uses `--path-as-is` (otherwise `/auth/../admin` was normalised client-side and not tested). Added a 5-step operator README.
- Not run against a real Traefik (tag, encoded-path behaviour, UCC invite/deactivate need operator rehearsal).
