# Task 551 — Analytics redesign (Claude set: Ringkasan / Klinikal / Duit & Operasi)

Spec: /home/dev/ai-logs/analytics-design-claude/summary.md (Task 547a). Verified against the code (not guessed).

## Findings
- **Unpaid invoices do not exist.** `lib/fhir/billing-service.ts` `validateCheckoutInput` throws
  "Full payment is required before checkout completion"; every Invoice is written `status: balanced` with
  `balance <= 0`. => "bil belum bayar", unpaid ageing, registered->paid funnel and "billing collected %" are DROPPED.
- No payment-method breakdown (product decision).
- Tenancy: Encounter/Condition/Procedure/MedicationRequest/MedicationDispense/Invoice/ServiceRequest/Appointment/
  Communication all carry `identifier clinic|<id>` -> every query uses it and results are re-filtered with
  `resourceMatchesClinicTenant` (so `_elements` always includes `identifier`/`meta`).
- Encounters: triage encounters carry extension `https://ucc.emr/triage-encounter` (queueAddedAt); saved consultations
  (`saveConsultationToMedplum`) are separate finished Encounters without it. Visits = unique (patient, MYT day);
  consultations = encounters without the triage extension.
- Wait time: no "consultation started" timestamp is stored. Same definition as the old page: queue arrival
  (queueAddedAt) -> first consultation encounter of that patient-day, kept when 0 < wait <= 8h. No sample => empty state.
- Dispense: `MedicationDispense` (status completed, `medicationReference.display`, `quantity`) written at checkout (Task 358).
- Orders: lab = `ServiceRequest` category SNOMED 108252007; POCT adds `meta.tag https://ucc.emr/poct|poct`;
  X-ray = category 363679005 (+ tag `https://ucc.emr/xray|xray` for device orders). COUNTS ONLY (`_summary=count`),
  no Observation/DiagnosticReport is ever read => no result values, no critical warnings.
- MC / time chit: `Procedure` with JSON in `note[0].text` (`kind: mc` / `kind: time-chit`); counted from bounded window fetch.
- New vs returning: Patient `meta.tag https://ucc.emr/patient-registered|YYYY-MM-DD` (MYT day) -> count in range; legacy
  untagged patients count as returning.
- Appointments: status `noshow` / `cancelled` / `fulfilled` / `arrived` exist (`appointment-service.ts`).
- Inventory: Medication `stock`/`minimumStock` (reorder level) via `getInventoryMedicationsFromMedplum` (<=500 rows).
- Follow-ups: Communication category `https://ucc.emr/communication-category`, status preparation/in-progress/completed/stopped.

## Design / perf
- Time zone Asia/Kuala_Lumpur (UTC+8) for day/hour buckets.
- One bounded search per resource per tab, paged (<=1000/page, hard caps), `_elements` trimmed; counts use
  `_summary=count&_total=accurate`. No force-dynamic full table loads. Old `computeAnalytics` (300 patients + all encounters) removed.
- `GET /api/analytics/[tab]?range=` (auth + clinic + module gate), in-memory 60s cache per clinic/tab/range with in-flight
  de-dup; response `Cache-Control: private, max-age=30`. Ringkasan (default) is streamed from the server component via Suspense;
  other tabs load lazily on first click. Skeletons everywhere.
- Charts: existing `recharts` 3.x plus plain SVG/CSS (sparkline, heatmap).
- Deviations from spec: "all-time revenue" hint replaced by 6-month total (unbounded sum is not cheap); wait trend uses
  daily averages when samples exist.

## Docs
- Medplum search: https://www.medplum.com/docs/search/basic-search , `_summary=count`, `_elements`, `_total=accurate`
- FHIR R4 Encounter/Invoice/Appointment/MedicationDispense/ServiceRequest search params: https://hl7.org/fhir/R4/
- Next.js 16 route handlers / Suspense streaming: https://nextjs.org/docs ; React 19 `use()`.

## Verification (dev Medplum, fake data, clinic `demo`)
- Unit: 682 pass; tsc + clinic-admin check + eslint (analytics paths) clean.
- Browser (Playwright, 1440x900 + 390x844): all three tabs render with real data, no console errors. Screenshots in /home/dev/ai-logs/analytics-551/.
- Dev-server tab load incl. cold query 1.2-2.5 s on the 1,500-encounter demo clinic (1,000+ encounters on one day); repeats served from the 60 s server cache.
- Dev finding: the service credential gets 403 on MedicationDispense (policy not updated for Task 358 on dev) -> "Ubat paling banyak dispens" shows its empty state there; sources are optional so the tab still renders. Check the policy on staging.
- The existing app shell keeps the desktop sidebar open at 390px (not changed here); layout tolerates ~200px content, and a collapsed-sidebar phone shot is included.
- Seeded 20 fake Appointments (identifier https://ucc.emr/seed/task551) for the first screenshots, then deleted them.
