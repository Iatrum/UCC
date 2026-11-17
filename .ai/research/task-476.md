# Task 476: small UX-FINDINGS fixes (#14, #15, #18)

Verified on `origin/dev` @ 115a40d. Fake data only; one dev server on :3476, killed afterwards.

## #15 Queue row menu confirmations (`components/queue-table.tsx`)
- "Remove from Queue" **already had** an shadcn `AlertDialog` on dev (commit c2f7d00); the audit missed it. No change.
- "Mark as Complete" had none. Added a second `AlertDialog` (same pattern). Other menu items untouched. Lib queue code untouched (Task 472).
- shadcn AlertDialog (Radix): https://ui.shadcn.com/docs/components/alert-dialog

## #14 Labs & Imaging live-updates hint
- `/api/labs/subscription` returns 503 when the Medplum WebSocket Subscription flow is unavailable (by design; the tab polls every 30 s).
- `startLabResultUpdates` got an optional `onLiveStatus(live)` callback: false on non-OK subscription, bad binding, socket error/close, true on the `handshake` frame. Routine lease renewals disconnect quietly (no flicker). `LabResultsView` shows "· Live updates off – press Refresh" in the muted status line next to "Last updated" (`data-testid=lab-live-off`). No POCT order/result behaviour changed.
- Medplum WebSocket subscriptions: https://www.medplum.com/docs/subscriptions/websocket-subscriptions

## #18 `/api/consultations?recent=` empty fields: two real mapping bugs
Route -> `getRecentConsultationsFromMedplum` (`lib/fhir/consultation-service.ts`), clinic-scoped by the `clinic` identifier search plus `matchesClinic`; scoping unchanged.
1. **Empty `patientId`**: `buildSavedConsultation` read only the `firebase-patient` Encounter identifier, which only `saveConsultationToMedplum` writes. Encounters from check-in/triage have none, so `patientId` was `''`. Now falls back to the `Encounter.subject` `Patient/<id>`; identifier still wins.
2. **Empty `chiefComplaint`/`diagnosis` on some rows**: the child searches (Condition/Observation/Procedure/MedicationRequest `encounter=Encounter/a,Encounter/b,...`) had no `_count`, and FHIR search pages default to 20 (Medplum default `_count` 20, max 1000: https://www.medplum.com/docs/search/paging). With up to 10+ encounters, later encounters' children fell off page 1 and mapped to `''`. Now `_count=1000` on the bulk searches (recent and per-patient lists).
- Still legitimately empty: encounters with no signed complaint Observation / Condition yet (check-in-only visits). That is data, not a bug.
- Residual: >1000 child rows per page of encounters would still truncate (needs `searchResources` pagination); not reachable with the current `limit` defaults.
