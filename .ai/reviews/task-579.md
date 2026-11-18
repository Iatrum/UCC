# Task 579: review of Task 578 (PR #309)
Date 2026-11-18. Verdict: **APPROVE** (two small doc fixes pushed).

- Production safety: diff touches only repo files (`infra/staging/*`, `scripts/staging/*`, tests, `.ai`). Rehearsal compose is loopback `127.0.0.1:8180`, no Docker socket, API/dashboard off, pinned tag, own `ucc-stg-*` names. No `medplum-*`/`root-traefik-1`, `/opt/medplum`, `/root` or Vercel/DNS change. No `ucc-stg*`/rehearsal containers left running.
- Matches plan: 385d marked done with honest caveats (no real-token invite, no TLS/ufw/sshd/DOCKER-USER). Allowlist paths agree with a code grep (`/auth`, `/oauth2`, `/fhir`, `/storage`, `/healthcheck`, `POST admin/projects/<id>/invite` at `lib/fhir/admin-service.ts:909`).
- Runbook commands: curl/cp commands are exact and read-only apart from the `cp` backup; rollback is the backup restore. Fixed: (1) plan said 13 denied paths, probe has 14; (2) step 0 assumed a file-provider config, but production Traefik may use Docker labels (can't be seen from the agent account), so a caveat was added.
- Remaining caveat for Hidayat: the `PathRegexp` invite rule was only exercised on Traefik v3.5.0; confirm the production Traefik major version is v3 (PathRegexp/Method syntax differs in v2).
- Checks: `tsc --noEmit` clean; `bun test` staging-rehearsal + staging-exposure 8 pass; `bash -n` on the three scripts OK; rehearsal compose `config -q` OK. Probe not re-run (would start containers; Task 578 reported PROBE OK).
- PR #309 was MERGEABLE vs dev (dev already an ancestor).
