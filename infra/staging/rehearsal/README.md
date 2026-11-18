# Staging rehearsal proxy (plan 385d) — operator steps

Loopback only, fake data, nothing here touches production (`medplum-*`, `root-traefik-1`).

1. Start staging: `bun run staging:up` (stop if it refuses for low memory).
2. Pick a pinned Traefik tag (never `latest`), then: `TRAEFIK_IMAGE_TAG=<tag> infra/staging/rehearsal/rehearse.sh`
3. Check: `bun run staging:probe` — must end with `PROBE OK`. Any `FAIL` means stop and fix before production.
4. Rehearse UCC invite/deactivate through `http://127.0.0.1:8180`. If they fail, add only the exact minimal `/admin` prefix to `dynamic/medplum-allowlist.yml`, re-run step 3, and record it in the plan.
5. Clean up: `infra/staging/rehearsal/rehearse.sh down`, then `bun run staging:down`.

Not rehearsable here (do on the real host with console access and an `at` rollback timer): TLS/HSTS/redirect, ufw, sshd, DOCKER-USER.

## Exposure audit kit (Task 570, read-only, Hidayat or root runs it)

Parsers only: they read pasted output and compose files, run nothing. Exit 1 = findings. Keep the output private (it has IPs).

```bash
# 1. repo files (safe anywhere)
bun run staging:audit compose infra/staging/docker-compose.yml infra/staging/rehearsal/docker-compose.yml infra/pacs-dev/docker-compose.yml
# 2. on the VPS (plan 1.3 inventory): ports published beyond loopback / 80 / 443
docker ps --format '{{.Names}}\t{{.Ports}}' | bun run staging:audit docker-ps
ss -tuln | bun run staging:audit listeners          # allowed public: tcp 22, 80, 443
# 3. from a machine OUTSIDE the VPS (plan probe A), real proof that Docker ports are closed
nmap -Pn -oG - -p 22,80,443,3000,5000,5432,6379,8080,8042,4242,8103,8113,3210 VPS_IP | bun run staging:audit nmap
```
Run 2 and 3 before the first lockdown step and after each one. Findings are inputs to the plan, not auto-fixes. Production compose files under `/opt/medplum` can be audited with `compose <path>` by someone with access; agents do not read them.
Limits: line-based compose parsing (no YAML engine; templated host IPs are reported as unprovable), IPv6 `nmap -6` needs a separate run, UDP is not scanned by step 3.
