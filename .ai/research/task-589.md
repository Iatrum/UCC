# Task 589 — pilot regression walk (after #307, #308, #311, #312, #313 in `dev`, base 51b9a58)

Setup: fresh worktree on origin/dev, ONE `next dev --webpack -p 3210` (heap cap 3072) against dev Medplum `:8113`, demo clinic, fake data only,
Playwright wrapped in `timeout`. Walk script: `task-589/walk.spec.ts.txt` (copy to `e2e/tests/*.spec.ts` to rerun; not committed as a spec because it leaves fake patients behind and would join the gate).
Screenshots + `walk-results.json` (ids and analytics text stripped) in `task-589/`.

## Result: no regression found → docs-only PR

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 01 | Login | PASS | 01-login.png |
| 02 | Register patient (allergy, emergency contact) | PASS | 02-register.png |
| 03 | Check-in + triage vitals → queue (10 Observations) | PASS | 03-checkin-triage.png |
| 04 | Start consult, note, diagnosis J02.9, Sign | PASS | 04a-consult-filled.png, 04-*.png |
| 05 | Composer: medication (real autosave path kept item, plan POST 200), lab order (FBC), MC dialog, Time Chit dialog (1.5 h, preview), no "critical" text in composer | PASS | 05a/05b/05c |
| 06 | Sign treatment → MedicationRequest, ServiceRequest, Procedures `MEDICAL CERTIFICATE (MC)` + `TIME CHIT` completed | PASS | 06-sign-treatment.png |
| 07 | Labs & Imaging tab renders (order without result shows "No lab results"; results only appear here) | PASS | 07-*.png |
| 08 | Documents tab: Time Chit preview (`TIME CHIT / SURAT MASA`) and MC preview | PASS (3/3 in isolation; 1 flake in run 2, see below) | 08a, 08b (retry0) |
| 09 | Checkout: total RM 35.50, invoice `balanced`, Paracetamol stock 494→493 (−1), exactly 1 MedicationDispense (`completed`, linked to the consult encounter) | PASS | 09a-checkout.png, 09-*.png |
| 10 | Analytics › Ringkasan (Hari ini): KPIs, revenue, visits, peak-hours render | PASS | 10-analytics-ringkasan.png |
| 11 | Analytics › Klinikal: MC 3 / 4 time chit, top diagnoses, dispensed meds (Paracetamol), orders by type "keputusan di tab Lab" | PASS | 11-analytics-klinikal.png |
| 12 | Analytics › Duit & Operasi: revenue by source (Ubat/Prosedur/Lab/X-ray/Dokumen), stock vs reorder | PASS | 12-analytics-duit-operasi.png |
| 13 | Inventory › Items shows Paracetamol | PASS | 13-inventory.png |

Time Chit is always on (no toggle) — it was offered in the composer and Documents tab with no module setting.

## Walk-harness issues (not app bugs)
- Run 1 had two false failures from my own assertions: step 07 expected an ordered-but-unresulted lab to be listed (the tab is results-only by design) and
  step 09 looked up the dispense on the first Encounter (the visit has two: a check-in/triage encounter and the consultation encounter; the dispense is on the latter). Fixed in the script.
- Analytics "passes" in run 1 were vacuous (skeletons only); script now waits for `[aria-busy]` to clear. All three tabs then showed real data.
- Run 2 step 08 failed with `ERR_CONNECTION_REFUSED` / HMR websocket closed: the dev server's `next-server` child restarted mid-step (infra, memory-capped dev). Re-ran the step 3× in isolation: all pass.

## Observations (pre-existing, no change made)
- `POST /api/labs/subscription` → 503 on the patient Labs tab: live updates off locally ("press Refresh" shown); not related to the merged PRs.
- `GET /api/billing?consultationId=…` → 404 twice on opening checkout (no invoice yet) — expected lookup.
- Two Encounters per visit (check-in vs consultation); `app/api/consultations/route.ts` untouched by the merged PRs.
- Analytics Ringkasan deltas look large (-98.6 % consults vs previous period) because the dev demo clinic carries many fake rows from older e2e runs; not a calculation issue evidenced here.
- Leftover fake patients (`Walk Fake <run>`) remain in the dev Medplum, same as other e2e specs.

## Not done
Full `check-all.sh` gate was not run (no code changed). Lab result ingest / POCT / PACS were outside this walk.
