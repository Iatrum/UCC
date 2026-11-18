# Pilot readiness checklist (Task 597, 2026-11-18)

Docs only. Written from the repo and the existing notes; **nothing was run against a server** and no server, DNS, Traefik, Vercel or production container was touched. All build steps of `.ai/PLAN-network-lockdown-staging.md` (385a-d) are done; 385e is a decision, not code. Fake data only everywhere.

## 1. Done (repo side), with evidence

| Area | Status | Evidence |
|---|---|---|
| Staging compose, env template, start/stop/guard scripts (385a) | Done, never brought up on a real staging server | `infra/staging/`, `scripts/staging/`, `.ai/PLAN-staging-promotion-checklist.md` |
| Safe-target preflight + idempotent staging seed (385b) | Done, unit-tested | `tests/unit/staging-preflight.test.ts`, `scripts/staging/bootstrap.ts` |
| Staging gate adapter with baseline identity check (385c) | Done, unit-tested | `e2e/scripts/check-staging.sh`, `tests/unit/staging-gate.test.ts` |
| Allowlist proxy rehearsed on loopback (385d) | Done: `staging:probe` ended `PROBE OK` (Traefik v3.5.0, Medplum 5.2.15) | plan step 385d, `infra/staging/rehearsal/dynamic/medplum-allowlist.yml`, `scripts/staging/probe.sh`, `tests/unit/staging-rehearsal.test.ts`, `.ai/reviews/task-579.md` |
| Read-only exposure audit kit | Done, never run on the real host | `scripts/staging/audit-exposure.ts`, `tests/unit/staging-exposure.test.ts`, `.ai/reviews/task-571.md` |
| Production Traefik allowlist runbook | Written, not applied | plan Part 3 |
| Clinic isolation: write and update-by-id containment | Done | BACKLOG Tasks 396, 400, 482; `lib/fhir/write-containment.ts` |
| Clinic AccessPolicy topology (non-superAdmin project) | Done on **dev only** | `.ai/RUNBOOK-task5-production-migration.md`, DECISIONS D46, `.ai/progress-task5.md` |
| Device ingress needs per-device keys (POCT/imaging) | Done | BACKLOG Tasks 180, 355 |
| Twilio status callback signature check | Done | BACKLOG Task 541, `app/api/follow-up/twilio/status/route.ts` |
| Checkout stock auto-deduct, no double deduct | Done | Task 358/402 commits; `.ai/PILOT-CHECK.md` (branch Task 558, `dispense-checkout-ui` 4/4) |
| `/api/labs/receive` 400 (not 500) on missing status; unknown/foreign order 404 with zero writes | Done | Tasks 566/572, `tests/unit/task566-labs-receive-validation.test.ts`, `tests/unit/task572-receive-not-found.test.ts` |
| Staff walk register -> consult -> sign -> Lab tab -> checkout -> dispense | PASS as non-admin on dev | `.ai/PILOT-CHECK.md` (merged into this branch) |

## 2. Hidayat must do manually (server / DNS / Vercel / root)

Follow `.ai/PLAN-network-lockdown-staging.md` Part 1 and Part 3 one step at a time, with console access and a snapshot first.

- [ ] Take a Hostinger snapshot and confirm console access (plan Part 1 step 1.1).
- [ ] Run the inventory and the audit kit on the VPS and from outside (`bun run staging:audit`; plan 1.2/1.3). Fix what it flags.
- [ ] ufw, sshd hardening and DOCKER-USER rules, each with an `at` rollback timer (plan 1.4 onward).
- [ ] Production Traefik allowlist (Part 3). First check whether the API router is a dynamic file or Docker labels on `medplum-server`; the runbook covers both.
- [ ] TLS/HSTS/redirect checks (cannot be rehearsed on loopback).
- [ ] Admin UI reachable by SSH tunnel only (owner decision 2: no Tailscale for now; plan 1.6). If Tailscale is adopted later: `tailscale serve`, never `funnel`.
- [ ] Run one real user invite through the allowlisted proxy on staging (`bun run staging:seed` first).
- [ ] Production Task 5 migration (non-superAdmin clinic project + AccessPolicies) using `.ai/RUNBOOK-task5-production-migration.md`.
- [ ] Firestore draft migration if still pending: `.ai/RUNBOOK-firestore-draft-migration.md`.
- [ ] Bring up staging once (`.ai/PLAN-staging-promotion-checklist.md`), run `check-staging.sh` against it, and record sign-off in `.ai/STATE.md`.
- [ ] Set production env and Vercel settings for the pilot clinic (Firebase project, OAuth client, device keys, `TWILIO_AUTH_TOKEN` plus `TWILIO_STATUS_CALLBACK_URL`). Agents do not touch these.
- [ ] Decide 385e: second VPS (public staging host, Vercel preview project, true Traefik/TLS rehearsal). RAM budget in plan 2.3, risks in 2.6.

## 3. Remaining gaps before a clinic pilot

| Gap | Why it matters | Evidence |
|---|---|---|
| Staging has **never been run end to end** on a real server (bring-up, seed, gate) | Gate adapter and scripts are unit-tested only | plan 385a/385c notes: "never run against a real staging stack" |
| 385c not finished: exact approved-exception list and skip classification | A staging gate can pass with unreviewed skips | plan step 385c "Not yet done" |
| Production network is unchanged until the manual steps above | Medplum API host currently forwards all paths | plan Part 3; the audit kit has not been run on the host |
| Production AccessPolicy isolation not applied (dev only) | In a superAdmin project the policy is bypassed (D20/D46) | `.ai/RUNBOOK-task5-production-migration.md` |
| Analytics "Revenue" counts ordered lines, not invoiced/paid amounts (needs a product decision). Age/gender charts are now exact (Task 564) | Pilot owners may read revenue as cash received | `.ai/PILOT-CHECK.md` item 3; `tests/unit/task564-analytics-exact.test.ts` |
| Consultation Fee defaults to RM 0.00; no catalog-driven default | Clinic must set a price or checkout under-bills | `.ai/PILOT-CHECK.md` item 5 (`patient-profile-workspace.tsx:80-84`) |
| No post-payment receipt view (toast and Bill preview only) | Confirm with the clinic whether a receipt is required | `.ai/PILOT-CHECK.md` item 7 |
| Time Chit (now core, Task 527, with the unified MC/Time Chit renderer, Task 549) was not walked in the Task 558 staff walk; only unit/e2e specs cover it | Walk it once before the pilot | `.ai/PILOT-CHECK.md` table; `tests/unit/time-chit.test.ts` |
| Successful invite through the proxy not rehearsed (only the 401 route check) | A broken allowlist would block user onboarding | plan 385d "Not rehearsed" |
| Walk used a user without an AccessPolicy | Proves the flow as non-admin, not policy enforcement | `.ai/PILOT-CHECK.md` setup note |
| Medplum login limit (5/min) can look like a wrong password in repeated e2e runs | Only a test nuisance; the UI message was fixed (Task 412) | `.ai/PILOT-CHECK.md` item 9 |
| Version drift: notes say Medplum 5.2.8, dev server runs 5.2.15 | Pin and test the version production will run | plan step 385d |

## 4. Rules that must stay true in the pilot
Composer unchanged; Lab/POCT results only in the Lab tab with no critical-result warning in the composer; POCT orderable only when the analyser is online, no manual entry; every clinical resource carries its `clinic` identifier and is never read across clinics; Firebase Storage stays.
