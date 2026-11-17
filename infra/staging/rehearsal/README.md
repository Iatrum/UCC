# Staging rehearsal proxy (plan 385d) — operator steps

Loopback only, fake data, nothing here touches production (`medplum-*`, `root-traefik-1`).

1. Start staging: `bun run staging:up` (stop if it refuses for low memory).
2. Pick a pinned Traefik tag (never `latest`), then: `TRAEFIK_IMAGE_TAG=<tag> infra/staging/rehearsal/rehearse.sh`
3. Check: `bun run staging:probe` — must end with `PROBE OK`. Any `FAIL` means stop and fix before production.
4. Rehearse UCC invite/deactivate through `http://127.0.0.1:8180`. If they fail, add only the exact minimal `/admin` prefix to `dynamic/medplum-allowlist.yml`, re-run step 3, and record it in the plan.
5. Clean up: `infra/staging/rehearsal/rehearse.sh down`, then `bun run staging:down`.

Not rehearsable here (do on the real host with console access and an `at` rollback timer): TLS/HSTS/redirect, ufw, sshd, DOCKER-USER.
