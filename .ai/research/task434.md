# Task 434 — real patient counts + reachable pages

Problem: Patients page showed `patients.length` of a `_count=200` fetch as "Total/New" and Analytics showed `length` of a 300 fetch.

## Sources
- FHIR R4 search (`_total`, `_summary=count`): https://hl7.org/fhir/R4/search.html
  - `_total=accurate` asks for exact `Bundle.total` (optional hint, server may ignore); `_summary=count` / `_count=0` returns only the total, no entries.
- Medplum paginated search: https://www.medplum.com/docs/search/paginated-search
  - Default `_total=none`; `accurate` costs more; above `accurateCountThreshold` (1M hosted) Medplum returns an estimate anyway.
  - `_count` max 1000 (default 20); `_offset` supported up to 10,000 (use `_cursor` beyond).

## Decision
- Count = `search('Patient', {active:true, identifier: clinic|<id>, _summary:'count', _total:'accurate'})` -> `bundle.total`. Same clinic identifier filter as the list, so counts are clinic-scoped. A defensive null total (server ignored hint) is returned as unknown and the UI shows the loaded count with a "+" label rather than a wrong exact number.
- Pages: `GET /api/patients?page=N&pageSize=M` (`_count`, `_offset`, `_total=accurate`, clamp pageSize<=100, offset<=10000).
- Search: server-side via existing `?search=` (name/NRIC/IC, clinic post-filter), debounced in UI.
- "New this month" counts `_lastUpdated>=month start` (createdAt in this app already maps to `meta.lastUpdated`).
