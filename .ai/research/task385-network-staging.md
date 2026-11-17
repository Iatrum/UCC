# Task 385 research: network lockdown + staging plan

Date: 2026-11-16. Docs/plan only. Nothing on the VPS was changed. The only host inspection was `docker ps --format '{{.Names}}\t{{.Ports}}'` (names and ports), `free -m`, and `docker stats` for **dev-owned** containers (`ucc-dev-*`, `ucc-pacs-*`). No `medplum-*` / `root-traefik-1` / `/opt/medplum` / `/root` content was read.

## Sources actually read (and what they gave)

| Source | Verified takeaway |
|---|---|
| [Docker: packet filtering & firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/) | Docker does NAT for published ports in the `nat` table; packets are diverted before the `INPUT` chain that ufw uses, so ufw rules do not govern published container ports. Don't edit Docker's own rules. Setting `iptables:false` generally breaks container networking. |
| [Docker: firewall with iptables](https://docs.docker.com/engine/network/firewall-iptables/) | `DOCKER-USER` is the supported place for user rules, processed before Docker's rules. Published ports are open to all sources by default. Example: `iptables -I DOCKER-USER -i ext_if ! -s <ip> -j DROP`. After DNAT only the container IP/port is visible; to match the original public address/port use `-m conntrack --ctorigdst/--ctorigdstport` (may cost performance). Page has **no** ip6tables example: IPv6 must be checked separately. |
| [Docker: port publishing](https://docs.docker.com/engine/network/port-publishing/) | Default publish = all host addresses (`0.0.0.0` and `[::]`). Loopback only: `-p 127.0.0.1:8080:80` (and `[::1]` for IPv6). Daemon-wide default: `"ip": "127.0.0.1"` in `daemon.json` (needs daemon restart: **do not do this on the shared box**, it would change every container including Traefik). |
| [Medplum server config](https://www.medplum.com/docs/self-hosting/server-config) | `port` default 8103; `baseUrl`, `appBaseUrl`; `allowedOrigins` (comma list, appBaseUrl auto-included); `registerEnabled` default `true`, `false` rejects `/auth/newuser` and `/auth/newproject`; `database.ssl.require` default false; Redis/DB are plain config objects (no need to be reachable from outside); `allowUnsafeOutbound` default false (keep). |
| [Medplum self-hosting overview](https://www.medplum.com/docs/self-hosting) | Audience is DevOps with healthcare production experience; AWS CDK is the recommended path, Ubuntu APT also supported. No VPS-specific hardening guide exists in the overview; the plan therefore leans on Docker/Traefik/OpenSSH docs, not on Medplum claims. |
| [Traefik Docker provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/) | `exposedByDefault` default is `true` (every container becomes a route unless set false and labelled). Unrestricted Docker socket access is a host-compromise risk; Traefik recommends a socket proxy (Tecnativa). |
| [Traefik getting-started with Docker](https://doc.traefik.io/traefik/getting-started/docker/) | `--api.insecure=true` publishes an unauthenticated dashboard on :8080; docs say "Do not enable this flag in production." |
| [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) | `tailscale serve` shares a local service with the tailnet only (`funnel` is the public one). `tailscale serve localhost:3000`, `--tcp=`, `off`, `status`, `reset`. Tailscale-issued HTTPS certs. |
| [Tailscale subnets / ACL](https://tailscale.com/kb/1019/subnets) | Tailnet access is governed by access-control policy; E2E encrypted. (Tailscale SSH and Docker caveats were not on the fetched page: not claimed.) |
| [OpenBSD sshd_config(5)](https://man.openbsd.org/sshd_config) | `PasswordAuthentication` defaults yes; `PermitRootLogin` default `prohibit-password`; `AllowUsers` absent = all users; `MaxAuthTries` default 6; for most keywords the **first obtained value wins** and `Include` globs are processed lexically (so a `00-` drop-in beats later files). `AllowUsers` is the exception (appends). Page does not document `sshd -t`; that flag is from sshd(8), used as a standard step. |
| [Next.js: self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | Use a reverse proxy in front of `next start`; `NEXT_PUBLIC_*` is inlined at `next build` (so a build is per environment); server-only env can be read at runtime (one image promotable if no public vars differ); multiple instances need same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and a build id; disable proxy buffering for streaming. |
| [Next.js: deploying](https://nextjs.org/docs/app/getting-started/deploying) | Node server / Docker / static / adapters; Next 16 docs. |

Existing repo notes reused (not re-derived): `.ai/plans/task7-medplum-network.md` (Medplum v5.2.8 mounts the API router at four prefixes, so path-deny on `/admin` alone is insufficient), `.ai/plans/task8-staging.md` (separate instance, non-superAdmin project, separate Firebase, `NEXT_PUBLIC` rebuild), D20 (superAdmin).

## Facts observed on this host (read-only, 2026-11-16)

- `docker ps` names and ports: Traefik is the ONLY container publishing public ports (80, 443, IPv4+IPv6). `medplum-medplum-server-1` (5000, 8103), `medplum-medplum-app-1` (3000, 8080), `medplum-postgres-1` (5432), `medplum-redis-1` (6379) publish **no host port** (container-internal only). Dev-owned: `ucc-dev-medplum` on 127.0.0.1:8113; `ucc-pacs-orthanc` on 127.0.0.1:8042/4242; pg/redis unpublished.
- Not observable without reading prod config: what Traefik routes (labels/rules), whether the dashboard/API is on, how it reaches the Docker socket, host listeners (`ss`), ufw state, sshd config, the Medplum server's `registerEnabled`. The runbook starts by having Hidayat capture those.
- `docs/DEPLOYMENT.md` says the UCC Next app is on **Vercel**; so a public Medplum API is required today (browser + Vercel server both call it from non-fixed IPs). Re-verify that this is still true.
- Memory 2026-11-16: 7.9 GB total, ~5.7 GB used, ~2.3 GB available. Dev stack measured: dev Medplum 485 MiB, dev Postgres 215 MiB, dev Redis 16 MiB, Orthanc 77 MiB, OHIF 3 MiB.

## Self-critique

- Biggest risk: the lockdown can lock Hidayat out of SSH or break clinic logins. Mitigation in the plan: automatic timed rollback (`at`), a second live SSH session, the Hostinger out-of-band console, one change per step, test-before-and-after probes.
- ufw alone would look secure and not be (Docker bypass). The plan relies on "nothing is published except Traefik" as the real control and verifies it from outside, then uses ufw/`DOCKER-USER` as a backstop.
- Not claimed: Hostinger hPanel firewall details, Tailscale+Docker behaviour, exact Traefik labels. Marked "verify".
