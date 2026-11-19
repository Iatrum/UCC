# Task 661 — policied pilot walk (PILOT-READINESS A12)

Dev only: Medplum `127.0.0.1:8113` (`ucc-medplum-dev`, 5.2.15), fake data, ONE `next dev --webpack -p 3210` (heap cap 3072, own process group, killed at the end; port verified closed), Playwright wrapped in `timeout`. Worktree `/home/dev/ucc-661` on `origin/dev` 805106a. No production container, `/opt/medplum`, `/root`, Supabase or Tradebot touched. No super-admin login was needed: the default dev platform-admin login (project admin, not super) was enough, so there was no "missing credential" stop condition.

Docs used: Medplum access policies (https://www.medplum.com/docs/access/access-policies), prior topology notes `.ai/research/task5-topology.md`, D47, `.ai/progress-task5.md`. Nothing here changes app code.

## Preflight (`task-661/preflight.mjs`, run before the walk)
| Check | Result |
|---|---|
| Project "UCC Clinics" `superAdmin` | **false** (Task 5 topology in place on dev) |
| `task5-demo@` / `task5-clinicb@example.invalid` memberships | `admin=false`, one `access[]` entry each carrying `clinicAccount`, `clinicOrganization`, `clinicWriteAccounts` |
| Deployed "UCC Clinic Staff Policy" vs repo definition (`clinicStaffPolicyDrift`) | no drift (Patient has no `create`) |

## Walk as `task5-demo` (clinic `demo`, policied, non-admin) — `task-661/walk.spec.ts.txt`, `walk-results.json`, `shots/`
| # | Step | Result |
|---|---|---|
| 01 | UI login as the policied staff | PASS |
| 02 | Register patient (server route stamps clinic `demo`; staff cannot POST Patient themselves) | PASS |
| 03 | Check-in + triage vitals → queue | PASS |
| 04 | Consult, note, diagnosis J02.9, Sign | PASS |
| 05 | Composer: medication (real autosave, plan POST 200), FBC lab order, MC and Time Chit dialogs; no "critical" text in composer | PASS |
| 06 | Sign treatment → MedicationRequest, ServiceRequest, Procedures MC + TIME CHIT completed | PASS |
| 07 | Simulated analyser Device in `demo` posts FBC results to `/api/labs/receive` (200); result shows **only** in Labs & Imaging tab | PASS |
| 08 | Documents tab: Time Chit + MC previews | PASS |
| 09 | Checkout RM 35.50, invoice `balanced`, Paracetamol stock 493 → 492, exactly 1 MedicationDispense | PASS |

## Enforcement (same policied staff, Medplum FHIR directly with its own bearer token, plus the app API)
Foreign fixture: a fake Patient + Encounter stamped for clinic `clinicb` (created by the service client, deleted afterwards).
| Probe | Result |
|---|---|
| Positive controls: own-clinic Patient read / update | 200 / 200 (policy is not simply denying everything) |
| Foreign Patient read, `Patient?_id=`, `Encounter?patient=` | 404, 0 hits, 0 hits |
| `Patient?_count=200` as `demo` staff | 200 patients, **0** outside clinic `demo` |
| Foreign Patient update (PUT) / delete | 404 / 404 (patient unchanged) |
| Create ServiceRequest for foreign patient | **403** |
| Forged `POST Patient` with foreign `clinic` identifier + account | **403** |
| List ProjectMembership / User / AccessPolicy | 403 / 403 / 403 |
| Reverse: `task5-clinicb` token vs the walk patient (clinic `demo`): read / search / PUT / create ServiceRequest | 404 / 0 / 404 / 403 (walk patient name unchanged) |
| App layer, demo session: `/api/billing?patientId=<foreign>` → 0 invoices; `?consultationId=<foreign encounter>` | 200 with empty list; 404 |

All raw status values are in `walk-results.json` (`facts.enforcementProbes`). Foreign update/delete return 404 rather than 403 because the policy hides the resource entirely; the probe accepts either denial, as `staff-membership.spec.ts` does.

## Harness notes (not app bugs)
- Run 1 failed steps 07–09: first hit of `/api/labs/receive` cold-compiled under the capped dev server, the request timed out and the browser page crashed. Enforcement steps in that run already passed. Fix: warm the route and allow 180 s; run 2 passed 13/13 in 2.9 min.
- Expected console noise only: `401 /api/auth/me` before login, `503 /api/labs/subscription` (A11), `404 /api/billing` lookup before an invoice exists.
- The spec is stored as `.txt` (not under `e2e/tests`) because it leaves fake `Policied Walk Fake` patients in dev and would otherwise join the gate. To rerun: copy to `e2e/tests/task661.spec.ts`, start one dev server, `UCC_USER=task5-demo@example.invalid`, `UCC_BASE_URL=http://127.0.0.1:3210`.
- Fake staff `task5-demo@` / `task5-clinicb@example.invalid` already existed on dev (created by Task 5 tooling, `scripts/access-policy/make-fake-staff.mjs`) and were left in place. The e2e global-setup rewrote the shared git-ignored `e2e/.secrets/state.json` with that staff session (worktree `e2e/.secrets` was a symlink to the main checkout's); it is replaced by the next run's login.
- Medplum auth is limited to 5/min; the spec waits 15 s before each direct staff login.

## Not done / limits
- Dev only. Production still needs the manual Task 5 migration (`.ai/RUNBOOK-task5-production-migration.md`) before this proof applies to it.
- Not run: the full `check-all.sh` gate (no code changed), analytics tabs (covered by Task 589), PACS/POCT-online ordering.
- The app server credential remains a trusted project-scoped credential by design (see `task5-topology.md`); this proof covers staff tokens only.
