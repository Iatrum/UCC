# infra/staging

Repo-side staging Medplum (Task 525, plan `.ai/PLAN-network-lockdown-staging.md` Part 2). Not started by any task.

- `docker-compose.yml`: project `ucc-staging`; containers `ucc-stg-medplum`, `ucc-stg-pg`, `ucc-stg-redis`; only `127.0.0.1:8123` is published; `mem_limit`+`memswap_limit` on all.
- `up.sh [up|down|guard|config]`: refuses to start below 600 MB available memory; `guard` shuts staging down below that (the plan's stop condition); first run generates git-ignored secrets (`.env.staging.local`, `secrets/`), never printed.
- `../../.env.staging.example`: placeholders only for the UCC app staging env.
- Seed and safety: `bun run staging:preflight`, `bun run staging:seed` (see `.ai/PLAN-staging-promotion-checklist.md`).

Unverified until first bring-up (not done here): the exact `file:` config keys for the pinned Medplum image, the Postgres image major version Medplum expects, first-project/super-admin bootstrap on the empty staging DB.

## Medplum version
The dev server (`ucc-dev-medplum`) runs `medplum/medplum-server:5.2.15` (checked with `docker inspect`, Task 607). Older notes and `AGENTS.md` said 5.2.8; the SDK in `package.json` is `^5.1.13`. Staging should pin `MEDPLUM_IMAGE_TAG=5.2.15` so it rehearses what dev tested, unless the production version (check it yourself on the production host) differs, in which case pin production's version and re-run the rehearsal on it. Never use `latest`.
