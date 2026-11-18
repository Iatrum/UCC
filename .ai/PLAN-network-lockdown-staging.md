# Plan: network lockdown + staging environment (Task 385)

Date: 2026-11-16. **Docs only.** Nothing here was run on the VPS. Every command below is for **Hidayat to run himself**, one step at a time. Agents never touch production (`medplum-*`, `root-traefik-1`, `/opt/medplum`, `/root`). Sources and caveats: [research](research/task385-network-staging.md). Builds on [Task 7](plans/task7-medplum-network.md) (path-level gateway rules) and [Task 8](plans/task8-staging.md) (staging gate rules).

## Plain-language summary (for a non-engineer)

**Where we are.** The server (the Hostinger VPS) runs the real clinic database system (Medplum) and a front door program (Traefik). From the container list I could see, only the front door is open to the internet (web ports 80 and 443). The database (Postgres) and the cache (Redis) are *not* exposed to the internet. That is good. The development test copy and the X-ray image store (Orthanc) I run for testing are also bound to the server itself only.

**What I could not see**, and you must check: the front door's own settings (which web addresses it forwards, whether its admin dashboard is on, how it talks to Docker), whether the server's firewall is switched on, how SSH (remote login) is set up, and whether public sign-up on Medplum is off. These are the likely weak spots, so Part 1 begins with a read-only checklist for them.

**One thing that surprised me and matters.** A common belief is "turn on the firewall (ufw) and Docker ports are protected". That is **not true**: Docker's published ports go around ufw. So the plan does not trust ufw alone. It checks from *outside* the server, and adds a second safety rule that Docker honours.

**Plan 1, lockdown, in short.** (a) Look and write down what is open today. (b) Turn on the firewall with a rollback timer so a mistake undoes itself in 10 minutes. (c) Make SSH key-only. (d) Optionally add Tailscale (a private network) so admin things need your device, not just a password. (e) Check from outside that only the web ports answer. The live clinic app must keep working: staff in browsers (and the Vercel-hosted app) still need to reach Medplum's login and data address, so that one address stays public. We protect it with strong accounts and per-clinic access rules, not by hiding it.

**Plan 2, staging, in short.** A practice copy of the whole system with **fake data only**, separate from real clinics. Changes move dev → staging → production, each with a checklist. **Honest limit:** the server has about 2.3 GB of free memory today. A full staging stack needs about 1.3 GB. It does **not** fit next to dev and production at the same time. Recommended: start staging only for a release test and stop dev meanwhile, and later move staging to a second small server.

**What I need from you:** run the Part 1 inventory (step 0), paste back the sanitised results (no passwords), and decide the open questions at the end.

---

# Part 1: Network lockdown runbook (production VPS)

## 1.0 Target picture

| Thing | Should be | Why |
|---|---|---|
| Traefik 80/443 | **Public** (80 only redirects to 443) | only intended front door |
| Medplum **API** (`/auth`, `/oauth2`, `/fhir`, `/.well-known`, Binary) | Public via Traefik, HTTPS only | the UCC app (browser + Vercel) must reach it; Vercel has no fixed IPs, so an IP allowlist is not possible without paid static IPs |
| Medplum **App** (admin web UI, container 3000/8080) | Not public; reach via Tailscale or SSH tunnel (see 1.6) | admin UI is the biggest target. Hiding it does not secure the API (Task 7), it only removes an attack surface |
| Medplum `/admin/*`, health, metrics | Prefer not public. Caveat: UCC's own server-side invite/deactivate flows call admin endpoints, so confirm the path before blocking (Task 7: Medplum mounts the router at four prefixes) | needs the test in 1.6 |
| Postgres 5432, Redis 6379 | **Never public.** No host port, Docker-internal network only. Today true by `docker ps`. | |
| Orthanc 8042 / 4242, OHIF | **Never public.** Loopback only (already, in dev). A real X-ray device later gets a LAN/VPN bind, not the internet | |
| Traefik dashboard (8080) / API | Off or Tailscale only | `--api.insecure=true` is unauthenticated; Traefik docs say not for production |
| Docker socket | Not mounted into anything except via a filtered socket proxy | socket = root on the host |
| SSH 22 | Key-only, no root password; later Tailscale-only | |
| Device ingress (`/api/labs/receive`, `/api/imaging/receive`) | These live in the UCC app (Vercel), not the VPS. Per-device key auth already fails closed (Tasks 180/355) | |

## 1.1 Rules for running this runbook

1. **Two SSH sessions open** the whole time. Know your **Hostinger out-of-band console** (hPanel browser terminal/VNC; verify it exists on your plan *before* you start).
2. **One change per step.** After each step run the 1.2 probes. If any probe regresses, run that step's rollback immediately.
3. **Maintenance window**, off-hours, clinics told. Take a **Hostinger snapshot/backup first** (hPanel; verify the restore path) and note the date.
4. Never paste secrets into chat/PR. Redact IPs of staff homes.
5. Do not change Traefik/Medplum containers' config in the same window as firewall changes (Task 7 §6: one boundary at a time).

## 1.2 Probe kit (run before the first change and after every step)

From **a machine outside the VPS** (your laptop on mobile data, not the VPS itself). `VPS_IP` and `API_HOST`, `APP_HOST` are placeholders:

```bash
# A. Only 80/443 (+22) should answer. Expect: 80,443 open (22 stays open until the optional Tailscale step 1.8 closes it; 1.5 only hardens SSH). Nothing else.
nmap -Pn -p 22,80,443,3000,5000,5432,6379,8080,8042,4242,8103,8113,3210 VPS_IP
# IPv6 too (ufw/docker treat it separately)
nmap -6 -Pn -p 22,80,443,5432,6379,8080 VPS_IPV6        # if the VPS has a public IPv6
# B. The app still works
curl -sS -o /dev/null -w '%{http_code}\n' https://API_HOST/healthcheck   # expect 200
curl -sS -o /dev/null -w '%{http_code}\n' http://API_HOST/ -L --max-redirs 0   # expect 301/308 to https
# C. Admin UI reachability (target state: NOT 200 from outside after 1.6)
curl -sS -o /dev/null -w '%{http_code}\n' https://APP_HOST/
# D. Real login still works: log into UCC as a TEST user in a private window (do not use a real patient)
```

Save the output (no secrets) to compare before/after. Probe A from outside is the **real** test, because ufw state does not prove Docker ports are closed.

## 1.3 Step 0: read-only inventory (changes nothing)

Run on the VPS, save output to a private file. Redact tokens.

```bash
sudo ss -tulpn | grep LISTEN                       # every host listener
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Networks}}'
sudo ufw status verbose || echo "ufw not installed"
sudo iptables -S DOCKER-USER; sudo ip6tables -S DOCKER-USER 2>&1 | head
sudo sshd -T | grep -Ei 'passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractive|allowusers|port '
ls /etc/ssh/sshd_config.d/
last -n 15 | head -20; sudo journalctl -u ssh --since '7 days ago' | grep -c 'Failed password'
```

Then, in **your own** Traefik config (you know where; agents were not allowed to read `/root`), answer these yes/no. Each "yes" is a finding:
- [ ] `api.insecure=true` / dashboard published on 8080 or a public router?
- [ ] `exposedByDefault` true (default) so any new container is auto-published?
- [ ] Docker socket mounted into Traefik read-write / no socket proxy?
- [ ] A router for the Medplum **App** host open to everyone? For the Medplum **server** host, are paths other than the ones UCC needs open?
- [ ] HTTP→HTTPS redirect on? Any non-443 TLS entrypoint?

In the Medplum server's config (your side), check: `registerEnabled` (should be `false` if nobody needs self sign-up; docs: `false` rejects `/auth/newuser` and `/auth/newproject`), `allowedOrigins` limited to the real app origins, `allowUnsafeOutbound` unset/false, the clinic project is **not** superAdmin (D20).

Also confirm in the Vercel project (docs/DEPLOYMENT.md says Vercel) that the Next app is still hosted there. If it moved onto this VPS, add a row to 1.0 for its port (must be Traefik-only, never published).

**Gate:** send me the redacted results. Do not proceed to 1.4 until you've seen probe A show nothing but 80/443/22.

## 1.4 Step 1: host firewall (ufw) with auto-rollback

Goal: default-deny inbound for **host** services. (This does *not* protect Docker-published ports; those are handled in 1.7.)

```bash
# SAFETY NET first: a timer that turns the firewall off in 10 min unless you cancel it
sudo apt-get install -y at && sudo systemctl enable --now atd
echo 'ufw --force disable' | sudo at now + 10 minutes
sudo atq        # note the job number

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'ssh'
sudo ufw allow 80/tcp comment 'http redirect'
sudo ufw allow 443/tcp comment 'https'
sudo ufw --force enable
sudo ufw status verbose
```

Open a **new** SSH session now (not reuse). If it connects and probes 1.2 pass, cancel the timer: `sudo atrm <job>`. If the new session fails: wait 10 minutes (or use the Hostinger console) and the firewall disables itself.

Rollback: `sudo ufw disable` (rules stay stored; re-enable later). Full reset: `sudo ufw reset` (removes all rules; then redo step 1).

## 1.5 Step 2: SSH hardening

Make sure **your public key login works first** (`ssh -o PreferredAuthentications=publickey you@VPS_IP`), from a second terminal.

OpenSSH uses the **first** value it reads and processes `Include` files in lexical order (sshd_config(5)), so name the drop-in so it sorts first:

```bash
sudo cp -a /etc/ssh /root/ssh-backup-$(date +%F)      # your own backup, outside the repo
sudo tee /etc/ssh/sshd_config.d/00-ucc-hardening.conf >/dev/null <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers YOUR_ADMIN_USER
CONF
sudo sshd -t && sudo systemctl reload ssh      # `sshd -t` checks syntax first; do not reload if it errors
sudo sshd -T | grep -Ei 'passwordauthentication|permitrootlogin|allowusers'   # confirm the effective values
```

Test from a **new** session with the key; test that a password attempt is refused. Keep the old session open until confirmed.

Do **not** change the SSH port in this window (Ubuntu 24.04 uses socket activation, which complicates port changes; the port change adds little once password login is off).

Rollback: `sudo rm /etc/ssh/sshd_config.d/00-ucc-hardening.conf && sudo sshd -t && sudo systemctl reload ssh` (or from the Hostinger console if locked out).

Optional: `fail2ban` for the sshd jail. Low value once passwords are off; skip unless the log count in step 0 is high.

## 1.6 Step 3: Medplum App/admin exposure and Medplum config

Decide **how you will reach the admin UI after it's closed**; set that up *before* closing it. Two options:

- **Zero-install: SSH tunnel.** `ssh -L 8081:<app-container-ip-or-loopback>:3000 you@VPS_IP` then open `http://localhost:8081`. Requires the app to be reachable from the host: either add a loopback-only publish `127.0.0.1:3000:3000` (a Medplum compose change you make) or use `docker inspect` to read the container IP. Caveat: the Medplum App is built with an API base URL; if it points to the public API hostname it still works through a tunnel for the UI, but OAuth redirects use the configured `appBaseUrl`. **Test this on the dev stack first** (`:8113`); not guessed.
- **Tailscale** (1.8), then publish the App only on the tailnet.

Then, as separate, reversible changes:
1. Traefik: remove (or restrict to a tailnet-only entrypoint) the router for the **App** host. Keep the API router. Reload Traefik, run probes B/C/D. *Rollback: restore the saved Traefik dynamic config file and reload.*
2. If Step 0 found `registerEnabled` is true: set it to `false`, restart only the Medplum server container in the window. First confirm on dev (`ucc-dev-medplum`) that UCC login, invite and deactivation still work (they use admin endpoints, not `/auth/newuser`). *Rollback: set back, restart.*
3. Path restrictions for `/admin/*`: Task 7 shows Medplum mounts the API at `/`, `/api/`, `/projects/:id/` and `/api/projects/:id/`. A Traefik rule blocking only `/admin` can be bypassed. Either block all four forms (and test percent-encoding/double-slash), **or skip path blocking** and rely on membership/AccessPolicy (needs the non-superAdmin project from D20). Do this only after rehearsing on staging (Part 2). Not a day-one step.
4. Enable `database.ssl.require` only if Postgres ever leaves the Docker internal network; not needed today.

## 1.7 Step 4: Docker published-port backstop (`DOCKER-USER`)

Why: ufw does not filter published container ports (Docker docs). Today only Traefik publishes, so this is a **safety net** against a future `ports:` line by mistake.

Preferred control: **never add `ports:` without `127.0.0.1:`** and keep `docker ps` as the audit (probe A from outside). Review compose files for any `0.0.0.0` or bare `5432:5432`.

Optional hard backstop (only if you want it; maintenance window only). **The 1.4 timer does NOT cover this**: it only runs `ufw disable`, which leaves `DOCKER-USER` rules in place. Arm a separate timer first, and cancel it only after probes B/D pass:

```bash
# undo exactly the rules added below (does not touch any pre-existing DOCKER-USER rules)
echo 'for i in 1 2 3 4; do iptables -D DOCKER-USER 1; done' | sudo at now + 10 minutes   # only valid if DOCKER-USER was empty before; otherwise write the matching -D lines yourself
```


```bash
EXT=$(ip -o -4 route show to default | awk '{print $5}')    # e.g. eth0
# allow replies, allow public web ports to Traefik, drop the rest of what arrives from outside to containers
sudo iptables -I DOCKER-USER -i $EXT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I DOCKER-USER 2 -i $EXT -p tcp -m conntrack --ctorigdstport 80  --ctdir ORIGINAL -j ACCEPT
sudo iptables -I DOCKER-USER 3 -i $EXT -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j ACCEPT
# insert (not append): Docker's chain ends with a RETURN rule, a DROP appended after it would never run
sudo iptables -I DOCKER-USER 4 -i $EXT -j DROP
```

Docker's own example uses `-I DOCKER-USER -i ext_if ! -s <ip> -j DROP` and `--ctorigdst/--ctorigdstport` for original ports, with a performance warning. The `--ctdir` form above is a standard netfilter option, **not** in the fetched docs; rehearse on staging and check IPv6 separately with `ip6tables` (Docker docs give no example). Rules are lost on reboot unless persisted (`netfilter-persistent`), and a rule mistake can take **all clinics offline**, because Traefik's traffic passes through this chain. If unsure, skip this step; it's optional.

Rollback: `sudo iptables -F DOCKER-USER` then check `sudo iptables -S DOCKER-USER` still ends with `-A DOCKER-USER -j RETURN` (re-add it if missing), or reboot if not persisted.

## 1.8 Step 5 (optional): Tailscale for admin and SSH

Use when you want admin access to need *your device* as well as a key.

1. Install per Tailscale's Linux instructions; `sudo tailscale up` and log in; add your laptop/phone.
2. Test SSH over the tailnet: `ssh you@<tailscale-ip>`.
3. Admin UI over the tailnet only: `tailscale serve --bg --https=443 http://127.0.0.1:<loopback-port>` (shares to tailnet only; `funnel` would make it public: never use `funnel`). Check `tailscale serve status`.
4. Restrict with Tailscale ACLs: only your user/device group may reach the VPS on 22 and the admin port.
5. **Only after** steps 2-3 are proven from two devices: remove the public SSH rule (`sudo ufw delete allow 22/tcp`) and add `sudo ufw allow in on tailscale0 to any port 22 proto tcp`. Lockout risk: keep the Hostinger console and the `at` timer.

Not verified (docs not read): Tailscale + Docker interaction details; Tailscale SSH. Don't assume.

Rollback: `sudo ufw allow 22/tcp` (Hostinger console if needed); `sudo tailscale serve reset`; `sudo tailscale down`.

## 1.9 Step 6: Traefik hygiene (your config; edit one thing at a time)

- `api.insecure` off; if the dashboard is wanted, put it behind basic auth on a tailnet-only entrypoint.
- `providers.docker.exposedByDefault=false`, then label only the containers that should be routed.
- Replace the direct socket mount with a socket proxy (Tecnativa) limited to read-only container listing (Traefik's own recommendation).
- Forced HTTPS redirect on the `web` entrypoint; HSTS header; no wildcard "catch-all" router that forwards unknown hosts to Medplum.
- Rollback for each: restore the previous config file, then restart Traefik. Traefik restart is a few seconds of downtime for all clinics; do it in the window.

## 1.10 Final verification and ongoing

- Re-run all of 1.2 from outside; attach before/after to the PR/notes (no secrets).
- Confirm clinics can log in, open a patient, save and sign a note, upload to Firebase Storage (Storage stays), see Lab tab results.
- Calendar reminders: quarterly re-run of step 0 and probe A; after every Docker/compose change, re-run probe A.
- Update `.ai/STATE.md` with the date and what changed (no secrets).

## 1.11 Known limits

- Network rules do not fix data authorization: D20 (superAdmin project) and cross-clinic grants are separate. A closed port is not clinic isolation.
- The Medplum API stays public by design today. Reducing that needs a BFF (browser calls only the UCC app) which is a large separate project.
- Not verified because I was not allowed to look: Traefik labels, ufw state, sshd config, Medplum config.

---

# Part 2: Staging environment plan

## 2.1 Principles

- **Fake data only.** Staging never receives a Postgres dump, Firebase export or file from production. Seed with the existing fake 4-clinic seed (`scripts`/`e2e` seed; localhost-only guard today, a staging-specific seed runner is needed, Task 8).
- **Separate everything:** own compose project, own Postgres/Redis volumes, own Medplum project (non-superAdmin for the clinics), own Firebase project (Firestore drafts + Storage; Storage stays), own secrets, own OAuth client, own device keys, own hostnames and cookie domain.
- **Never** a second project on the production Medplum as "staging" (shared failure scope and operator account; Task 8).
- Naming: compose project `ucc-staging` (dev is `ucc-medplum-dev`, PACS `ucc-pacs-dev`; prod `medplum`). No container named `medplum-*` and no use of `root_default`/Traefik's network.

## 2.2 Layout on the VPS (loopback only)

| Piece | Compose project / name | Host binding |
|---|---|---|
| Medplum server | `ucc-staging` / `ucc-stg-medplum` | `127.0.0.1:8123` |
| Postgres, Redis | `ucc-stg-pg`, `ucc-stg-redis` | no host port |
| Next (production build, `next start`) | systemd or script, not Docker, to save RAM | `127.0.0.1:3220` |
| Medplum App (optional) | skip; use the dev one or API only | none |

Reach it from a laptop with an SSH tunnel or Tailscale (1.8); **no public DNS or Traefik route** for staging in phase 1. Because UCC hosting is on Vercel, a Vercel "staging" project could not reach a loopback Medplum. That is why phase 1 runs the staging Next app on the VPS and tunnels; a Vercel staging project only becomes possible when staging Medplum gets its own public hostname (second server, phase 2).

Env manifest (each environment has its own; values are never committed): `MEDPLUM_BASE_URL`, `NEXT_PUBLIC_MEDPLUM_BASE_URL`, e2e `MEDPLUM_URL`, `UCC_BASE_URL`, Medplum client id/project, Firebase project/bucket/service account, cookie domain, device keys. **`NEXT_PUBLIC_*` is inlined at `next build`**, so staging and production need separate builds of the same commit (Next.js self-hosting docs). Staging must also use the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` only within its own instances.

## 2.3 Resource budget (8 GB shared with production)

Measured 2026-11-16: total 7.9 GB, used ~5.7 GB, **available ~2.3 GB** (includes cache). Dev stack: Medplum 485 MiB + Postgres 215 MiB + Redis 16 MiB + Orthanc 77 MiB, plus the dev Next server (`--max-old-space-size=3072` is a *cap*, real use is lower but can spike).

| Component | Estimate |
|---|---|
| Staging Medplum (limit 1.5 GB like dev, typical ~0.5 GB) | ~0.5 GB |
| Staging Postgres (limit 768m) | ~0.2 GB |
| Staging Redis (limit 128m) | ~0.02 GB |
| Staging Next production server | ~0.4-0.6 GB (estimate, not measured) |
| Playwright runner (when testing) | ~0.5-1 GB (estimate) |
| **Staging total** | **~1.3 GB idle, ~2.3 GB while testing** |

Conclusion: dev **and** staging **and** production do not fit together safely (dev alone is already part of the 5.7 GB used). Rules:
1. Staging runs **only during a release test**, with the dev stack's Next server and PACS stopped (Medplum dev can stay or stop; free ~1 GB).
2. `mem_limit` and `memswap_limit` on every staging container (as the PACS compose already does); `NODE_OPTIONS=--max-old-space-size=2048` for staging Next; one Playwright worker.
3. Add a swap file (2-4 GB) as a **buffer**, not as capacity. Check first with `free -m`/`swapon --show`; this touches the host so it is yours to decide.
4. **Stop condition:** if `available` < 600 MB at any time, shut staging down (`docker compose -p ucc-staging down`, kill the Next process group). Production wins.
5. Phase 2 (recommended soon): a separate small VPS (about 4 GB) for staging/dev with a public staging hostname. That also allows a Vercel preview project and a true Traefik rehearsal, and removes the risk to production. Cost is a user decision; none is committed here.

## 2.4 Promotion: dev → staging → prod

| Stage | Where | Gate to move on |
|---|---|---|
| **dev** | `:3210` / Medplum `:8113`, local worktrees, `ai/*` branches | lint + build + `e2e/scripts/check-all.sh <label>` shows **no new failures** (baseline 22/23); review doc present; PR to `dev` (draft, never auto-merge) |
| **staging** | `ucc-staging`, fake data, production-mode build of the exact merged `dev` commit SHA | fresh seed; production-mode `next build` with *staging* `NEXT_PUBLIC_*`; smoke list below; negative tests (cross-clinic, admin denied, device without key refused); Lab results only in the Lab tab, no composer warnings; Hidayat signs off |
| **prod** | Vercel (app) + VPS (Medplum) | same SHA as staging, **built for prod**; window + clinics notified; rollback ready |

Smoke list on staging: login, patient registration, triage, composer hydrate/save/sign (must not break), MC/referral issuance, dispensing, Lab tab with simulated analyser result (POCT only when analyser online, no manual entry), Firebase upload/download, deactivate-user flow, time chit, PACS toggle off by default.

Rules: one SHA, no hot fixes on prod that skip staging (hotfix = branch from the prod SHA, same gates, shorter list); record SHA, build id and the staging checklist result in `.ai/STATE.md`. If the commit has Medplum **server version** changes, rehearse that upgrade on staging with a **fake** database and a `pg_dump` taken before. Fake data cannot show every migration issue; take a prod backup and a snapshot before a real upgrade anyway.

Prod rollback: Vercel → promote the previous deployment (instant); Medplum → previous image tag (always pin tags/digests, not `latest`; today's dev server uses `latest`, which hides which version is running) plus the pre-change DB backup. Never restore an old database over newer clinical writes without a decision from you.

## 2.5 Build order (small tasks, one commit each)

1. [x] (repo files, Task 525; never started, server bring-up untested) **385a** staging compose + `.env.staging.example` (no secrets) + start/stop scripts with the memory limits and the stop condition. Mirrors `infra/pacs-dev/`. Files: `infra/staging/`, `.env.staging.example`, `scripts/staging/`, checklist `.ai/PLAN-staging-promotion-checklist.md`.
2. [x] (repo files + unit test, Task 525; the empty staging DB bootstrap was automated in Task 533: `scripts/staging/bootstrap.ts`, run by `bun run staging:seed`, idempotent, refuses non-staging clients; untested against a real staging server) **385b** safe-target preflight (positive allowlist of staging hosts/projects, fails closed on anything else) and a staging seed runner. Do not weaken the localhost guards in existing seed/admin spec.
3. [x] (repo side, Task 533; unit-tested, never run against a real staging stack) **385c** staging gate adapter for `check-all.sh` with baseline identity check (Task 8: `compare.mjs` used to accept a missing baseline). Now: `e2e/scripts/check-staging.sh <label> <baseline>` runs the preflight, requires a baseline with an identity sidecar (`node e2e/scripts/lib/baseline.mjs write <results.json> staging`) and sets `UCC_GATE_TARGET=staging`, under which `compare.mjs` FAILS on a missing, malformed, foreign-target or hash-mismatched baseline. Local runs are unchanged. Not yet done: exact-approved-exception list and skip classification from the Task 8 note.
4. [x] **385d** rehearse the allowlist on a staging Traefik-equivalent (loopback). Repo side Task 556; **actually run in Task 578 (2026-11-18, dev account, loopback only, torn down afterwards)** with Traefik `v3.5.0` and Medplum `5.2.15` (the dev server's pinned tag; the stack notes say 5.2.8 elsewhere, the running version is 5.2.15). Result: `bun run staging:probe` ends `PROBE OK` (3 allowed, 5 invite checks, 13 denied paths incl. encodings, 5 loopback listeners). Findings: (a) **UCC invite calls `POST admin/projects/<id>/invite` server-side** (`lib/fhir/admin-service.ts:909`), so a pure allowlist without `/admin` would have broken user invites on production; a single anchored route (`Method POST && PathRegexp ^/admin/projects/[A-Za-z0-9-]+/invite$`) was added. Deactivate uses FHIR `ProjectMembership` (no `/admin`). (b) Traefik v3.5.0 collapses `//` before routing, so `POST //admin/projects/x/invite` is the same allowed route (harmless; `//admin/projects` stays 404). (c) `up.sh` bug fixed: the 0600 config was unreadable by the image user (EACCES); the container now runs as the operator uid with an ephemeral tmpfs for binaries. Not rehearsed: a *successful* invite with a real token (the proxy returns Medplum's own 401 without one, which proves routing only; do one real invite through the proxy in the Hostinger window on staging, `bun run staging:seed` first). Not rehearsable on loopback: TLS/HSTS/redirect, ufw, sshd, DOCKER-USER. **Next: production Traefik allowlist, see Part 3 (Hidayat only).**
5. [ ] **385e** (decision) second VPS.

## 2.6 Staging risks

- A shared Firebase project or ADC fallback could write fake data into production Firestore/Storage; a preflight must verify project ids (Task 8).
- Cookie domain `.iatrum.com` must never be used for staging.
- Staging tests are **destructive** to their own target; the preflight above is what prevents pointing them at production.
- Production-mode build uses more RAM than dev; serialise builds and do not run two builds at once.

---

# Part 3: Production Traefik allowlist runbook (Task 578; HIDAYAT ONLY, nothing here was run)

Agents cannot read `/root`, `/opt/medplum` or the production Traefik config, so this is written against the **rehearsed** staging file `infra/staging/rehearsal/dynamic/medplum-allowlist.yml`. It needs root, your Traefik config, and a maintenance window. Do it only after Part 1 steps 1.3 (inventory) and 1.4 (ufw with `at` timer) and after you have confirmed the Hostinger console and snapshot (owner decision 6). Owner decisions applied: Vercel stays, SSH tunnel only (no Tailscale), self-registration off.

**What changes:** the Medplum **API** host router currently forwards everything. Replace it by an allowlist so only the paths UCC uses answer. Everything else gets Traefik's 404.

Paths UCC needs (verified in code): `/auth/`, `/oauth2/`, `/fhir/`, `/.well-known/`, `/storage/`, `/healthcheck`, and exactly `POST /admin/projects/<id>/invite`. Not used by UCC: `/ws/` (no subscriptions found), `/email/`, `/scim/`, `/openapi.json`, `/api/*` mounts. **Re-grep before you apply** (`grep -rn "medplum\.\(post\|get\)\|getBaseUrl" lib app`) in case newer code needs more, and watch Traefik 404s after applying.

Steps (one at a time; the pre-change file is your rollback):
```bash
# 0. find your current dynamic config for the API host router and back it up (path is yours, not known to agents)
sudo cp -a <your-traefik-dynamic-dir> /root/traefik-dynamic-backup-$(date +%F-%H%M)
# 1. add this file next to your existing one, adapting only: entryPoints (your real https entrypoint, e.g. websecure),
#    the Host(`API_HOST`) matcher, tls/certResolver, and the service URL (your real medplum-server container + 8103):
#      medplum-api:    rule: Host(`API_HOST`) && (PathPrefix(`/auth/`) || PathPrefix(`/oauth2/`) || PathPrefix(`/fhir/`) ||
#                              PathPrefix(`/.well-known/`) || PathPrefix(`/storage/`) || Path(`/healthcheck`))     priority: 10
#      medplum-invite: rule: Host(`API_HOST`) && Method(`POST`) && PathRegexp(`^/admin/projects/[A-Za-z0-9-]+/invite$`)  priority: 20
# 2. REMOVE the old catch-all router for API_HOST in the same edit (an old broader router would still win or tie).
#    With the file provider + watch, Traefik reloads on save. Do not restart Traefik.
# 3. From OUTSIDE (laptop, mobile data) run, with API_HOST filled in:
curl -sS -o /dev/null -w '%{http_code}\n' https://API_HOST/healthcheck                      # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://API_HOST/.well-known/jwks.json            # 200
for p in /admin/projects /api/admin/projects //admin/projects /%61dmin/projects /metrics /openapi.json /fhir/../admin; do
  printf '%s -> ' "$p"; curl -sS --path-as-is -o /dev/null -w '%{http_code}\n' "https://API_HOST$p"; done              # all 404
curl -sS -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w 'invite no token: %{http_code}\n' https://API_HOST/admin/projects/x1/invite   # 401
# 4. App checks as a TEST user in a private window: login, open a patient, save a note, attach a file (Firebase),
#    then invite a TEST practitioner from Admin > Users > Invite (this is the one flow the allowlist could break) and deactivate it.
# 5. ANY failure: restore the backup dir into place (Traefik reloads) and re-run step 3's first two curls.
```
The Medplum **App** (admin UI) host is a separate router: remove it (1.6 item 1) only after you have tested the SSH-tunnel access on the dev stack. Keep `registerEnabled=false` (confirm it in step 0). TLS/HSTS/redirect are not covered by the rehearsal; confirm them with probe kit 1.2 B.

---

# Open questions for Hidayat

1. Is the UCC app still on Vercel, or any part on the VPS?
2. Do you want Tailscale (needs a Tailscale account), or SSH tunnel only for admin?
3. Does anyone legitimately need Medplum self-registration? (decides `registerEnabled=false`)
4. Is the production clinic project non-superAdmin? (D20; the single biggest authorization risk, independent of ports.)
5. Staging: stay on this VPS (time-boxed) or approve a second small VPS?
6. Does your Hostinger plan have a browser console and snapshot restore? (needed for safe rollback)

## Owner decisions (Hidayat, 16 Nov 2026 21:57 MYT)

1. UCC app: still hosted on Vercel.
2. Admin access to the VPS: SSH tunnel only (no Tailscale for now).
3. Medplum self-registration: not needed, close it.
4. Production clinic project already non-superAdmin? Unknown; must be verified (read-only) before any lockdown step that depends on it.
5. Staging: on this VPS for now (no second server yet).
6. Hostinger browser console and snapshot restore: unknown; confirm in the Hostinger panel before any firewall change, so there is a recovery path if SSH gets locked out.
