# Staging promotion checklist (Task 525)

Companion to `.ai/PLAN-network-lockdown-staging.md` Part 2. Fake data only. Staging runs only during a release test.

## Before starting (operator)
- [ ] `free -m`: available >= 600 MB; dev Next server and PACS stopped (plan 2.3).
- [ ] Release SHA = merged `dev` commit; record it in `.ai/STATE.md`.
- [ ] `cp .env.staging.example .env.staging.local`, fill with STAGING values only (separate Firebase project, OAuth client, device keys). Never reuse production values.
- [ ] `bun run staging:preflight` (with the env loaded) prints `staging preflight OK`.

## Bring up (operator; not done by Task 525)
- [ ] `MEDPLUM_IMAGE_TAG=<pinned> bun run staging:up` (refuses below 600 MB). Check `docker ps` shows only `ucc-stg-*` added.
- [ ] Bootstrap staging project + demo clinic Organization + doctor Practitioner (not automated yet) and a **non-superAdmin** clinic project (D20).
- [ ] Medplum seeds a default super admin (`admin@example.com` / `medplum_admin`) on an empty DB. Change that password first (loopback only, but never leave it); `staging:seed` refuses the default credentials.
- [ ] Port 3220 has been used ad hoc by verification worktrees: confirm `ss -tln | grep :3220` is empty before `next start`.
- [ ] `bun run staging:seed --dry-run`, then `bun run staging:seed` (needs `MEDPLUM_ADMIN_*` for staging).
- [ ] Production-mode build with staging `NEXT_PUBLIC_*` (`NODE_OPTIONS=--max-old-space-size=2048`, one build at a time); `next start -p 3220` bound to 127.0.0.1.
- [ ] Run `bun run staging:guard` periodically; it stops staging if available < 600 MB.

## Gates (plan 2.4)
- [ ] lint + build + `e2e/scripts/check-all.sh <label>`: no new failures vs baseline.
- [ ] Smoke: login, registration, triage, composer hydrate/save/sign, MC/referral, dispensing, Lab tab with simulated analyser (POCT only when analyser online, no manual entry), Firebase upload/download, deactivate-user, time chit, PACS off by default.
- [ ] Negative: cross-clinic read denied, admin denied, device without key refused; Lab results only in the Lab tab, no composer warnings.
- [ ] Sign-off recorded in `.ai/STATE.md` (SHA, build id, results).

## Tear down
- [ ] `bun run staging:down` and kill the staging Next process group; confirm `free -m`.

## Prod
- [ ] Same SHA, built for prod; window and clinics notified; rollback ready (previous Vercel deployment; pinned Medplum image + pre-change backup).
