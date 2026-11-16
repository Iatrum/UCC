# Review: Task 385 (PR #260) network lockdown runbook + staging plan

Reviewer: Claude (independent, Task 386), 2026-11-16. Docs only; nothing was run on the VPS. Reviewed `.ai/PLAN-network-lockdown-staging.md` and `.ai/research/task385-network-staging.md`.

**Verdict: APPROVE with changes (2 factual fixes applied in this commit; 5 items for the author or Hidayat below).** Nothing in the plan exposes Postgres, Redis or Orthanc. Every lockout-capable step has a rollback, with one gap (fixed, see F1).

## Fixed here (clear factual errors)

- **F1. The 1.4 timer was said to protect the `DOCKER-USER` step (1.7).** It does not: the timer runs `ufw --force disable`, and ufw never touches `DOCKER-USER`. A bad rule there would take every clinic offline with no automatic undo. SSH would stay reachable (SSH is INPUT, not forwarded), so no lockout, but it is still an outage. Added a separate `at` timer that deletes the added rules, with a caveat to write matching `-D` lines if the chain was not empty.
- **F2. Probe A said port 22 stays "until step 1.5 closes it".** 1.5 only hardens SSH; 22 is closed only by the optional 1.8. Corrected so the before/after comparison is not misread.

## Findings left for the author / Hidayat

1. **(Medium) Closing the Medplum App host (1.6 step 1) can break emailed links.** Medplum builds invite and password-reset email links from `appBaseUrl` (from memory of Medplum behaviour, not re-verified in docs here, so verify on dev). UCC's invite page defaults to `sendEmail: false` (`app/(admin)/admin/users/invite/page.tsx`) and the app has no forgot-password screen, so day-to-day impact is likely nil. But any invite with "Send Email Invite" on, or a reset started from Medplum itself, would point to a closed host. Add to 1.6: test one email invite on dev with the App host unreachable, or keep an `appBaseUrl` that is reachable for staff.
2. **(Medium) Rollback of the `DOCKER-USER` step uses `iptables -F DOCKER-USER`.** That also deletes any rules that existed before (1.3 prints them). Prefer `-D` of the four added rules. The "re-add RETURN" advice is harmless but not needed: an empty user chain falls through to Docker's rules.
3. **(Medium) Persisting `DOCKER-USER` via `netfilter-persistent`.** The plan says "rules are lost on reboot unless persisted", but restoring a saved ruleset at boot can clobber Docker's own chains depending on start order. The safer route is a small systemd unit ordered after `docker.service`. Not-persisting is the safe default; say so.
4. **(Low-Med) Tailscale (1.8).** (a) `tailscale serve --https=443` needs HTTPS certificates enabled in the tailnet admin console; add as a prerequisite. (b) Traefik already holds host :443; use `--https=8443` to avoid any ambiguity and allow it only on `tailscale0`. (c) "Keep the `at` timer" before removing public SSH: the 1.4 timer was cancelled, so say explicitly to arm a **new** one (`ufw allow 22/tcp`) before deleting the rule. (d) Plan already marks Tailscale+Docker and Tailscale SSH as not verified; good.
5. **(Low) SSH step (1.5).** The drop-in works only if the admin actually logs in as `YOUR_ADMIN_USER`; if Hidayat logs in as `root` today, `PermitRootLogin no` plus `AllowUsers` will lock that account out. The plan's second-session key test covers it, but state it in one plain sentence. Also confirm that user has sudo and a key in `authorized_keys`. The plan correctly keeps the old session open and has a console rollback.
6. **(Low) Probe B** `curl ... -L --max-redirs 0` is redundant and returns curl exit 47; drop `-L`. **UDP 443 (HTTP/3)**: the `DOCKER-USER` rules are TCP only, so HTTP/3 would be dropped if Traefik enables it (browsers fall back to TCP; fine, just note it). 1.4: ufw does not cover published ports, but it does block container-to-host traffic; probes B/D would catch any such dependency.

## Accuracy against official docs

- Docker bypasses ufw for published ports; `DOCKER-USER` is evaluated first; `ctorigdstport` is needed to match the pre-DNAT port; default publish is all addresses; `127.0.0.1:` binds loopback. Matches Docker's packet-filtering pages. The rule order (ESTABLISHED, 80, 443, then DROP, all inserted before Docker's RETURN) is correct. `--ctdir ORIGINAL` is a valid conntrack option; the plan correctly flags it as not in the fetched Docker page.
- Medplum `registerEnabled` default true and `false` rejecting `/auth/newuser` and `/auth/newproject`; `allowedOrigins`; `allowUnsafeOutbound`: consistent with the server-config docs. Note UCC does not use `/auth/newuser` (grep), so `registerEnabled=false` is low risk.
- Traefik `exposedByDefault` default true, `api.insecure` unauthenticated and not for production, socket-proxy advice: correct.
- sshd_config(5) first-value-wins, `Include` in lexical order, `AllowUsers` accumulating: correct. `00-` naming is right for Ubuntu's `Include` at the top of `sshd_config`. `sshd -t` is from sshd(8), correctly attributed.
- Tailscale `serve` (tailnet) vs `funnel` (public): correct.
- Next.js: `NEXT_PUBLIC_*` inlined at build so one build per environment: correct.

## Safety against exposure

- Postgres 5432 / Redis 6379: no host port in prod (per author's `docker ps`) and none in staging (2.2). Probe A tests both from outside, over IPv4 and IPv6.
- Orthanc 8042/4242: dev compose binds `127.0.0.1` only (`infra/pacs-dev/docker-compose.yml:34-35`, verified in repo); the OHIF proxy binds loopback and the bridge gateway. 1.0 and probe A cover them.
- Staging: loopback only, no Traefik route, no public DNS, separate Firebase, never a Postgres dump. Good. Cookie domain `.iatrum.com` banned for staging.
- Lockout: two sessions, Hostinger console check, `at` auto-disable for ufw, config test before reload, per-step rollback. Gaps F1 and item 4(c) above.
- No change touches the composer; Lab/POCT rules are restated, not altered.

## Readability for a non-engineer

The plain-language summary is clear and honest (including the "ufw does not protect Docker ports" surprise and the RAM limit). Weak spots: the step numbering is confusing (headers say "Step 0..6" but sections are 1.3..1.9, and the task is "Part 1/Part 2"); commands have no "what you should see" line; and jargon (DNAT, conntrack) appears in 1.7 without a one-line explanation. Suggest a 6-line "order of work and what can go wrong" table at the top of Part 1 and marking 1.7 and 1.8 as "optional, skip unless you want them" in the headings. Open question 6 (Hostinger console and snapshot) should be answered **before** step 1.4, not at the end.
