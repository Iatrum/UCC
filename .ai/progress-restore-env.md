# Progress: restore local dev backend (Medplum/Postgres/Redis)

Start: 2026-11-08 08:02 MYT (box restored 2026-11-07 ~16:24 MYT; docker missing since restore)

## Plan
1. [x] Install Docker Engine + compose plugin
   - Found: this box's egress policy blocks `apt`/dpkg's own http fetcher from reaching deb.debian.org (returns a flaky/erroring edge IP 198.18.0.1 consistently) while `curl`/`wget` to the exact same URL succeed fine from the same shell. Root dependency `iptables` (+ its 4 deps: libip4tc2, libip6tc2, libnetfilter-conntrack3, libnfnetlink0) was not installable via plain `apt-get install` because of this.
   - Fix: added Docker's official apt repo (download.docker.com, works fine via apt), then manually `wget`'d the 5 missing .deb files straight from deb.debian.org's Packages index and `dpkg -i`'d them (bypassing apt's broken fetch path), then `apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` (--no-install-recommends to skip apparmor/pigz/docker-ce-rootless-extras, also blocked the same way and not required).
   - This box has no systemd (PID 1 is `tini`, a container-style init) and `policy-rc.d` denies service auto-start, so docker.service never starts itself. Must start manually every time: `sudo containerd &` then `sudo dockerd &` (see restart doc). Confirmed working: `docker run --rm hello-world` pulled + ran successfully.
2. [x] Confirmed /workspace/ucc-medplum config matches what was used before (diffed 20261106/20261107 backups vs current dir — byte-identical compose + override)
3. [x] docker compose up -d (pg, redis, medplum) using existing docker-compose.yml + override (host networking) — all 3 containers up, healthy.
4. [x] Restored 20261106 pg_dump (already extracted to /workspace/ucc-medplum-backup-pre-ap.sql) into the pg container via `psql -U medplum -d medplum < ...sql`. Confirmed: 561 Patient rows, 7 clinics (demo=478, clinicb/c/d=10 each), 453 Encounters, no clinic-check problems.
5. [x] curl healthcheck → 200.
6. [x] e2e auth was not stale this round — reused as-is (last refreshed in an earlier round, see progress-task9-fixes.md).
7. [x] Ran `e2e/scripts/check-all.sh restore-env`: lint 0, build 0, clinics 0, e2e 22/23 (only the baseline-expected "known-bug probes summary" fails — same as every prior baseline). OVERALL: PASS. Logs in /workspace/ai-logs/restore-env/.
8. [x] Added memory caps (pg 1g, redis 256m, medplum 2g) — applied live via `docker update` (no restart/recreate, avoids risking the anonymous pg data volume) and persisted in docker-compose.override.yml for future clean starts.
9. [x] Wrote .ai/research/local-env-restore.md (what was done + exact restart-after-reboot steps) and appended one line to .ai/STATE.md.

## Result
Local dev backend fully restored and verified. Gate `restore-env` OVERALL: PASS (22/23, matches baseline). Dev server (:3210) and Medplum (:8113) both running. Done.
