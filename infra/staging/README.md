# infra/staging

Repo-side staging Medplum (Task 525, plan `.ai/PLAN-network-lockdown-staging.md` Part 2). Not started by any task.

- `docker-compose.yml`: project `ucc-staging`; containers `ucc-stg-medplum`, `ucc-stg-pg`, `ucc-stg-redis`; only `127.0.0.1:8123` is published; `mem_limit`+`memswap_limit` on all.
- `up.sh [up|down|guard|config]`: refuses to start below 600 MB available memory; `guard` shuts staging down below that (the plan's stop condition); first run generates git-ignored secrets (`.env.staging.local`, `secrets/`), never printed.
- `../../.env.staging.example`: placeholders only for the UCC app staging env.
- Seed and safety: `bun run staging:preflight`, `bun run staging:seed` (see `.ai/PLAN-staging-promotion-checklist.md`).

Unverified until first bring-up (not done here): the exact `file:` config keys for the pinned Medplum image, the Postgres image major version Medplum expects, first-project/super-admin bootstrap on the empty staging DB.
