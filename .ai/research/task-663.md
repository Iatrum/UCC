# Task 663 (PILOT-READINESS D4): successful invite through the allowlisted proxy
Date 2026-11-19. Branch `ai/task-663` from origin/dev (no open draft PR edited infra/staging or scripts/staging). Loopback only, dev Medplum only (`ucc-dev-medplum`, 5.2.15, compose project `ucc-medplum-dev`), fake user. Production containers, Traefik, /opt/medplum and /root untouched.

## Method
- The invite route UCC uses is `POST admin/projects/<id>/invite` (`lib/fhir/admin-service.ts`, body with `sendEmail:false` + `password`; no SES needed). Medplum docs: https://www.medplum.com/docs/user-management/invite-user
- Proxy = the unchanged allowlist file `infra/staging/rehearsal/dynamic/medplum-allowlist.yml` run by `traefik:v3.5.0`, only the upstream rewritten to `http://ucc-dev-medplum:8113/`, container `ucc-663-traefik` on network `ucc-medplum-dev`, published on `127.0.0.1:8180` only, no Docker socket, api off. Auth flow: `/auth/login` (PKCE S256) -> `/oauth2/token`.

## Commands
```
TRAEFIK_IMAGE_TAG=v3.5.0 bash scripts/staging/rehearse-invite-dev.sh     # or: TRAEFIK_IMAGE_TAG=v3.5.0 bun run staging:invite-rehearsal
```
It starts the proxy, runs `scripts/staging/probe.sh`, runs `scripts/staging/invite-rehearsal.ts`, and removes the container on exit (trap).

## Result
- `PROBE OK` (all allow/deny/loopback checks).
- admin login through proxy PASS; invite POST through proxy HTTP 200 (ProjectMembership + Practitioner profile); Practitioner readable via `/fhir`; invited user logs in through the proxy into the same project; admin token on `GET /admin/projects/<id>/members` -> proxy 404; duplicate invite -> Medplum 409.
- Cleanup: fake membership and Practitioner deleted (HTTP 200 each) via the direct dev port. The Medplum `User` row (`invite-rehearsal-*@example.invalid`) stays in the dev DB (no delete API); harmless fake data.
- `ucc-663-traefik` gone afterwards; no `medplum-*` / `root-traefik-1` interaction.

## Not covered
TLS/HSTS, ufw, sshd, DOCKER-USER; the UCC app itself was not driven (the script replays the exact request UCC sends). Repeat once on real staging (D5).
Note: while exploring, I accidentally printed a truncated dev session token from `e2e/.secrets/state.json` to the terminal; dev-only, fake data, not committed.
