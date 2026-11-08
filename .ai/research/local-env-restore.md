# Local dev backend restore — Docker/Medplum/Postgres/Redis (2026-11-08)

## Why
Box was restored 2026-11-07 ~16:24 MYT. Docker was gone (fresh install, no engine), so
the local Medplum 5.2.8 stack `.env.local` points at (`MEDPLUM_BASE_URL=http://localhost:8113`)
was down and `e2e/scripts/check-all.sh` could not run.

## What was found
- `/workspace/ucc-medplum/docker-compose.yml` + `docker-compose.override.yml` are the
  canonical compose config (byte-identical across the 20261106 and 20261107 backup
  tarballs and the live checkout) — three services, `network_mode: host` for all three
  (override file switches from bridge+ports to host networking + localhost DB/Redis
  hosts): `pg` (postgres:16, user/db `medplum`), `redis` (redis:7, password `medplum`),
  `medplum` (`medplum/medplum-server:latest`, port 8113, `MEDPLUM_APP_BASE_URL=http://localhost:3210/`).
- Postgres data is **not** a named volume in the compose file — it's the anonymous
  volume Docker auto-creates from the `postgres` image's own `VOLUME /var/lib/postgresql/data`
  declaration. This matters for restarts: a plain `docker compose up -d` (no recreate)
  reuses it fine, but `--force-recreate` / `docker compose down` followed by `up` would
  orphan it and lose the restored data. Don't force-recreate `pg` casually.
- Latest available pg_dump was in `/workspace/backups/ucc-backup-20261106.tar.gz`
  (20261107's tarball has config only, no DB dump) — already extracted to
  `/workspace/ucc-medplum-backup-pre-ap.sql` (plain-SQL `pg_dump` 16.15, ~61 MB).

## What was done
1. **Docker Engine + compose plugin install.** This box's `apt`/dpkg HTTP fetcher
   can't reach `deb.debian.org` (resolves to a flaky edge IP, `198.18.0.1`) even though
   `curl`/`wget` to the exact same URL work fine from the same shell. Worked around by:
   adding Docker's official apt repo (`download.docker.com`, reachable via apt
   directly) for the Docker packages themselves, then manually `wget`-ing the 5
   missing `iptables` dependency `.deb`s straight from `deb.debian.org`'s Packages
   index and `dpkg -i`-ing them, then
   `apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`
   (`--no-install-recommends` skips `apparmor`/`pigz`/`docker-ce-rootless-extras`,
   blocked the same way and not required).
2. **No systemd on this box** (PID 1 is `tini`; `policy-rc.d` denies service
   auto-start), so `docker.service` never starts itself — must be started manually
   every session/reboot (see "Restart after reboot" below).
3. Brought up the stack from `/workspace/ucc-medplum` with
   `sudo docker compose up -d` (uses the existing compose + override, host networking,
   same ports as before: Postgres 5432, Redis 6379, Medplum 8113).
4. Restored the dump: `sudo docker exec -i uccmp-pg-1 psql -U medplum -d medplum < /workspace/ucc-medplum-backup-pre-ap.sql`.
   Confirmed row counts afterward (`SELECT count(*) FROM "Patient"` → 561; clinic-check
   script found 7 clinics incl. `demo` with 478 patients, matching the pre-restore
   dataset size).
5. **Memory caps** (box has ~16 GB total, shared with the Next dev server capped at
   3072 MB per AGENTS.md, and Tradebot may also run): applied live via
   `docker update --memory=<X> --memory-swap=<X> <container>` so the already-running,
   already-restored containers didn't need a restart/recreate (which would have risked
   the anonymous pg volume) — `pg` 1g, `redis` 256m, `medplum` 2g. Same limits added to
   `docker-compose.override.yml` as `mem_limit`/`memswap_limit` so a future
   `docker compose up -d` (e.g. after a reboot) applies them from a clean start too.
6. e2e auth was **not** stale this round (last refreshed by an earlier round per
   `.ai/progress-task9-fixes.md` / STATE history) — reused as-is, no refresh needed.
7. Verified: `curl http://localhost:8113/healthcheck` → `200`. Full gate
   `e2e/scripts/check-all.sh restore-env`: lint 0, build 0, clinics 0, e2e 22/23 (the
   one failure is the baseline-expected "known-bug probes summary" test, same as every
   prior round's baseline). **OVERALL: PASS**, matching the pre-restore baseline.
   Logs: `/workspace/ai-logs/restore-env/` (`summary.txt`, `lint.log`, `build.log`,
   `clinics.log`, `e2e.log`, `results.json`).

## Restart after a reboot
No systemd — nothing restarts automatically. From scratch:

```bash
# 1. start the docker daemon (no systemd; must be done manually every boot)
sudo containerd &
sudo dockerd &
sleep 3   # wait for dockerd socket to come up

# 2. bring up pg/redis/medplum (reuses the existing anonymous pg volume as long as
#    you don't pass --force-recreate / didn't `down` the stack first)
cd /workspace/ucc-medplum
sudo docker compose up -d

# 3. confirm
curl http://localhost:8113/healthcheck   # expect 200
sudo docker exec uccmp-pg-1 psql -U medplum -d medplum -c 'select count(*) from "Patient";'
```

If the `pg`/`redis`/`medplum` containers still exist from before the reboot (Docker
just restarts stopped containers, doesn't delete them), `docker compose up -d` without
any `down` in between is enough and will **not** touch the pg data volume.

If the Postgres data volume is ever actually gone (e.g. someone ran `docker compose
down -v`, or a fresh box with no prior containers), restore the latest dump instead of
expecting data to already be there:

```bash
cd /workspace/ucc-medplum
sudo docker compose up -d
# wait for pg healthy, then:
sudo docker exec -i uccmp-pg-1 psql -U medplum -d medplum < /workspace/ucc-medplum-backup-pre-ap.sql
# or extract a fresher dump from /workspace/backups/ucc-backup-<date>.tar.gz first if one exists
```

Then re-run `e2e/scripts/check-all.sh <label>` to confirm before trusting the gate.

## Open items / notes for future rounds
- The 20261107 backup tarball has config but **no** DB dump — if a dump is needed again
  later, check `/workspace/backups/` for the newest tarball that actually contains one
  before falling back to the 20261106/pre-ap.sql dump used here (it will be stale by
  then).
- Docker daemon has no `--restart`/boot-persistence mechanism on this box (no systemd
  unit will pick it up); every environment reset that kills the `dockerd`/`containerd`
  processes needs the manual two-line restart above before anything compose-related
  will work.
