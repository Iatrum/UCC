# Pilot readiness checklist (Task 625, 2026-11-18; supersedes Task 597 version)

Checks for the **first clinic pilot**, from `.ai/PILOT-CHECK.md`, `.ai/PLAN-network-lockdown-staging.md`, `.ai/RUNBOOK-task5-production-migration.md` and the owner decisions already made. The dev rehearsals recorded here used fake data.

Legend: **DONE** = finished, with evidence. **CODE** = an agent can do it (small task, one commit). **OWNER** = needs Hidayat or the clinic to decide or act; agents must not implement or run it.

## Owner decisions already made (do not re-ask)

| Decision | Source |
|---|---|
| UCC app stays on Vercel | plan, owner decisions 16 Nov 2026 #1 |
| Staging access: **SSH tunnel only**, no Tailscale for now | plan owner decision #2; Task 598 review |
| Medplum self-registration closed (`registerEnabled=false`) | plan owner decision #3 |
| Staging lives on this VPS for now, no second server | plan owner decision #5 |
| **Yearly clinic subscriptions only** (no monthly plan) | Hidayat, owner decision (Task 625 brief); no code or billing flow depends on it yet |
| **Time Chit always on, no toggle** | `.ai/DECISIONS.md` D-527 (Task 527) |
| **MC and Time Chit share one template/renderer** | Task 549 (`lib/document-render.ts`), PR #307 merged |

## A. Application behaviour

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| A1 | Staff walk register -> consult -> sign -> Lab tab -> checkout -> dispense (non-admin) | DONE | `.ai/PILOT-CHECK.md` (Task 558), `dispense-checkout-ui` 4/4 |
| A2 | Checkout deducts stock once (no double deduct on retry) | DONE | Tasks 358/402 |
| A3 | Analytics counts quantity, lab/imaging lines, all consultations; age/gender exact | DONE | PILOT-CHECK fixes 1-2; Task 564 `tests/unit/task564-analytics-exact.test.ts` |
| A4 | `/api/labs/receive`: 400 on missing status, 404 on unknown/foreign order, no writes | DONE | Tasks 566/572; PILOT-CHECK #6 |
| A5 | Admin/login redirect loop, rate-limit message, stock 500 | DONE | Task 412; PILOT-CHECK #9 |
| A6 | Time Chit core, shares template with MC | DONE | D-527, Task 549 / #307 |
| A7 | Time Chit walked once as a staff user | DONE (dev) | Task 657 recorded a passing fake non-admin staff walk for creation, signing, opening the print frame and signed-document locking. The dedicated spec and report are in local commit `d9d4958`, outside PR #352. This branch has [Time Chit browser coverage](../e2e/tests/time-chit.spec.ts) and [unit coverage](../tests/unit/time-chit.test.ts). |
| A8 | PILOT-CHECK #3: what "Revenue" means in analytics (ordered lines vs invoiced/paid) | OWNER | Product decision; then CODE to compute from Invoice totals. Do not change before the decision |
| A9 | PILOT-CHECK #5: consultation fee price (default is RM 0.00) | OWNER | Clinic sets the price/default; then CODE (`app/(routes)/patients/[id]/patient-profile-workspace.tsx:79-83` (`unitPrice: 0`), `components/billing/bill-modal.tsx:154`) |
| A10 | PILOT-CHECK #7: post-payment receipt view required? (today: toast + Bill preview) | OWNER | Clinic decision; then CODE if yes |
| A11 | Console noise (`503 /api/labs/subscription`, expected 404 on billing lookup, documents abort) | DONE (Task 659, PR #326) | 503: client stops re-POSTing after the first 503 (manual Refresh re-checks); billing lookup uses `optional=true` (200, no bill yet); documents fetch aborted on unmount and silent. Residual: the browser itself logs the single first 503 network line (server contract kept, e2e relies on it). Notes `.ai/research/task-659.md` |
| A12 | Walk repeated with a user that **has** an AccessPolicy (proves enforcement, not only the flow) | DONE (dev) | Task 661: `.ai/research/task-661.md`. Fake staff with clinic `access[]` in the non-superAdmin project ran register → consult → sign → Lab tab → checkout → dispense (13/13 steps), and the same token was denied reading/writing a second clinic's patient (404/403, 0 search hits). Production still needs the manual Task 5 migration (B-section items) |

## B. Security and secrets

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| B1 | Write/update-by-id clinic containment | DONE | Tasks 396, 400, 482 |
| B2 | Per-device keys for POCT/imaging ingress | DONE | D45 (Task 180), Task 355 |
| B3 | Twilio status callback signature check | DONE | Task 541 |
| B4 | HTTP security headers, dependency audit | DONE | Task 599, [merged PR #318](https://github.com/Iatrum/UCC/pull/318), [header tests](../tests/unit/security-headers.test.ts). The [Task 599 audit](research/task-599.md) recorded two remaining high-severity dev-dependency findings at the time. |
| B5 | **Rotate the old password still in git history** (removed from scripts in #318; history keeps it) | OWNER | [#318 review](reviews/task-600.md). Rotate where it was used, then decide whether to rewrite history (never by an agent) |
| B6 | Production env/Vercel settings for the pilot clinic (Firebase project, OAuth client, device keys, `TWILIO_AUTH_TOKEN`, `TWILIO_STATUS_CALLBACK_URL`) | OWNER | Agents do not touch these |

## C. Isolation: production Task 5 migration

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| C1 | Clinic AccessPolicy topology (non-superAdmin clinic project) on **dev** | DONE | `.ai/REVIEW-task5.md`, D47, `.ai/progress-task5.md` |
| C2 | Verify read-only whether the production clinic project is superAdmin (owner Q4 unknown) | OWNER | Plan Part 1/open question 4; a superAdmin project bypasses the policy |
| C3 | Live disposable demotion, session revocation and rollback rehearsal | CODE (blocked) | [Merged PR #251](https://github.com/Iatrum/UCC/pull/251) supplies [the revocation helper](../scripts/access-policy/revoke-staff-sessions.mjs). The [runbook](RUNBOOK-task5-production-migration.md#fake-session-proof-required-before-release--outstanding-live) requires a newly supplied dev super-admin login from Hidayat, more than 100 fake Logins across multiple pages, and live clinic-isolation and session checks. |
| C4 | Exact-production-version rehearsal and current-head full browser gate | CODE (release hold) | [Merged #342](https://github.com/Iatrum/UCC/pull/342) fixed premature imaging completion. Tasks 738/739 verified checkout and fixed Sign retries in [open #352](https://github.com/Iatrum/UCC/pull/352). Evidence includes [Procedure status](../tests/unit/task704-order-procedure-status.test.ts), [workflow 06 and 09](../e2e/tests/workflow.spec.ts) and [X-ray](../e2e/tests/xray.spec.ts). Task 736 cleaned up the dev fixture and Task 737 verified the recovery. The [Task 739 gate](REVIEW-task738.md) on `044706f` passed 97 browser tests and the dev clinic data audit on Medplum 5.2.15. Verify the final release candidate on the exact production Medplum version and cover zero-value checkout and the stored-DICOM viewer, both skipped in Task 739. |
| C5 | Deployment recovery card (previous artifact, restorer, tested DB restore, writer stop/reopen) | OWNER | Runbook release hold; cannot be invented by an agent |
| C6 | Production cutover: operator project, `superAdmin=false`, policies, session revocation | OWNER | `.ai/RUNBOOK-task5-production-migration.md`; maintenance window, backups, checksum |
| C7 | Firestore draft migration, if still pending | OWNER | `.ai/RUNBOOK-firestore-draft-migration.md` |

## D. Network lockdown and staging (plan 385)

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| D1 | Staging compose, env template, scripts (385a); preflight + seed (385b); gate adapter (385c) | DONE | `infra/staging/`, `scripts/staging/`, `tests/unit/staging-*.test.ts` |
| D2 | Allowlist proxy rehearsed on loopback (`PROBE OK`, Traefik 3.5.0, Medplum 5.2.15) | DONE | Task 578, `.ai/reviews/task-579.md` |
| D3 | Staging gate exception list (fails on any unlisted skip) | DONE | Task 607, `e2e/staging-exceptions.json` |
| D4 | Successful user invite through the allowlisted proxy | DONE (dev, loopback) | The [Task 663 script rehearsal](research/task-663.md) recorded a successful invite and invited-user login, proxy 404 for the admin member list, and 409 for a duplicate invite. [PR #328 merged](https://github.com/Iatrum/UCC/pull/328) and includes [proxy rule tests](../tests/unit/staging-rehearsal.test.ts). Repeat on real staging (D5). |
| D5 | Bring staging up once on the VPS, seed, run `check-staging.sh`, record sign-off in STATE.md | OWNER | Touches the shared VPS; follow `.ai/PLAN-staging-promotion-checklist.md`. Never run end to end yet |
| D6 | Confirm Hostinger console + snapshot restore exist (owner Q6 unknown) | OWNER | Required before any firewall change |
| D7 | Host inventory + audit kit run on the VPS and from outside; fix what it flags | OWNER | Plan 1.3; `bun run staging:audit` (`scripts/staging/audit-exposure.ts`), never run on the real host |
| D8 | ufw, sshd hardening, DOCKER-USER rules, each with an `at` rollback timer | OWNER | Plan 1.4-1.7 |
| D9 | Admin UI reachable by SSH tunnel only; remove the Medplum App router after testing the tunnel on dev | OWNER | Plan 1.6; decision #2 |
| D10 | Production Traefik allowlist (check first: dynamic file or Docker labels on `medplum-server`) | OWNER | Plan Part 3 |
| D11 | TLS/HSTS/redirect checks (cannot be rehearsed on loopback) | OWNER | Plan 1.2 B |
| D12 | Confirm `registerEnabled=false` on production | OWNER | Plan step 0, decision #3 |
| D13 | Check the production Medplum version; pin staging/test on the same version (docs say 5.2.15) | OWNER | `infra/staging/README.md` |
| D14 | Second VPS for true public staging (385e) | not needed | Decision #5: stay on this VPS; revisit only if RAM is short (plan 2.3) |

## E. Business and clinic onboarding

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| E1 | Yearly-only subscription terms for the pilot clinic | OWNER | Decision made; contract/pricing/invoicing is Hidayat's. No code task until a billing flow is requested |
| E2 | Pilot clinic created with its `clinic` identifier, modules (POCT/PACS default off) and staff via invite | OWNER | Admin > Clinics; invite goes through the allowlisted route (D4, D10) |
| E3 | Analyser/imaging devices registered with keys, only if the pilot uses them | OWNER | POCT orderable only when the analyser is online, no manual entry |

## F. Rules that must stay true in the pilot

Composer unchanged; Lab/POCT results only in the Lab tab with no critical-result warning in the composer; POCT orderable only when the analyser is online, no manual entry; every clinical resource carries its `clinic` identifier and is never read across clinics; Firebase Storage stays.

## Go / no-go

Pilot can start when Hidayat completes or explicitly waives the applicable **OWNER** items in B–E, A8–A10 are decided and any required changes verified, and the remaining release checks in C3 and C4 pass.
