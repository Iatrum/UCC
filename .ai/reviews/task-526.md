# Review: Task 525 staging scaffold (PR #294)

Reviewer: Task 526. Scope: repo files only; nothing was brought up, no production resource touched.
Verdict: **APPROVE** (after the small fixes below, pushed to the PR branch).

## Checks
| Check | Result |
|---|---|
| Secrets / real values | PASS. Template has `REPLACE_*` placeholders and an all-zero project id; no PEM/key/UUID/real host in the diff. `.gitignore` covers `.env.staging*` (except `.example`), `infra/staging/.env.staging.local`, `infra/staging/secrets/`. Only `.env.staging.example` is tracked. Generated passwords/signing key are created at bring-up (umask 077) and never printed. |
| Loopback-only ports | PASS. Only `127.0.0.1:8123:8103` is published; pg/redis have no host port; app plan is `127.0.0.1:3220`. |
| Collisions | PASS. Read-only check: nothing listens on 8123/3220; dev is 8113, PACS 8042/4242. Names `ucc-stg-*`, project `ucc-staging`, volume `ucc-staging_stg-pg`, network subnet 172.31.58.0/24 (PACS 172.31.57.0/24; existing nets 172.17-20). No `medplum-*`, `root_default`, `/opt/medplum` or `/root` use. Note: port 3220 was used ad hoc by a verification worktree earlier; checklist now says to confirm it is free. |
| Fake data only | PASS. Seed delegates to the existing fake `seed-clinics.ts` (its localhost guard is untouched and accepts 127.0.0.1); runner refuses the dev admin credentials. |
| Matches plan Part 2 | PASS. 2.1 naming/separation, 2.2 layout, 2.3 mem limits (1536m/768m/128m + memswap, 600 MB stop condition, `NODE_OPTIONS=2048`), 2.5 items 385a/385b ticked honestly, 385c-e left open. |
| `docker compose config` | OK with a tag; fails closed without one (intended for `up`). |
| Unit test | `bun test tests/unit/staging-preflight.test.ts` 3/3 pass. |
| App rules | No app code changed: composer, Lab/POCT rules, clinic separation and Firebase Storage untouched. |

## Fixed in this review
1. **Stop condition could not run without a tag**: `down` and `guard` hit the compose `${MEDPLUM_IMAGE_TAG:?}` and aborted, so `staging:guard` could not shut staging down under memory pressure. Both now pass a placeholder tag (only the project name matters for `down`).
2. **`restart: unless-stopped`** would bring staging back after a host reboot on the shared production box; now `"no"` (plan: release-test only).
3. **Preflight gap**: browser-side `NEXT_PUBLIC_FIREBASE_PROJECT_ID`/`AUTH_DOMAIN` (inlined at build) and `FIREBASE_CLIENT_EMAIL` were not checked, so a build could target the production Firebase project while `FIREBASE_PROJECT_ID` looked right. Checks and tests added; template gained the `NEXT_PUBLIC_FIREBASE_*` placeholders.
4. Template comment pointed at a non-existent `e2e/scripts/staging-preflight.ts`; corrected.
5. Checklist: Medplum seeds `admin@example.com`/`medplum_admin` on an empty DB; added a step to change it before seeding.

## Non-blocking follow-ups (unverified, need a real bring-up)
- Medplum `file:` config keys, Postgres major version, first project/super-admin bootstrap, binary storage has no volume (fine for fake data).
- `up.sh` sources the root `.env.staging.local` with `. file`; a multi-line `FIREBASE_PRIVATE_KEY` there must be quoted (use `\n` form).
- The signing-key passphrase is briefly visible in `ps` during `openssl genpkey` (single-user host, loopback; acceptable, could use `-pass env:`).
- Sum of container limits is ~2.4 GB; with the 600 MB guard this is only safe with dev Next/PACS stopped, as the plan says.
