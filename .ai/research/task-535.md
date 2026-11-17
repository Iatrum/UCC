# Task 535 — registration day tag: live `_tag` OR-search + MYT clinic date

Sources: FHIR R4 search (token `system|code`, comma = OR, https://hl7.org/fhir/R4/search.html#token),
Medplum `_tag` built-in search param, MDN `Intl.DateTimeFormat` `timeZone` option.

## Finding 1 — server-local day (confirmed on origin/dev bb0a512)
`ymd()` used `getFullYear/getMonth/getDate`, i.e. server TZ. A UTC server between 00:00–08:00 MYT
stamped/searched the previous day (and wrong month at month boundaries).
**Fix:** `lib/fhir/patient-registration.ts` now derives Y/M/D with `Intl.DateTimeFormat('en-CA',
{timeZone:'Asia/Kuala_Lumpur'})` for both stamping (`withRegistrationTag`) and the month range
(`registeredThisMonthTagParam`). Unit tests (UTC instants around midnight MYT, month and year
rollover) pass under TZ=UTC, America/Los_Angeles and Asia/Kuala_Lumpur.

## Finding 2 — live `_tag` OR-search against dev Medplum :8113 (fake data, no dev server)
Fake patients `T535*` in clinics `t535-a` / `t535-b`: tagged today, day 1, previous month, untagged,
plus one stamped via `withRegistrationTag`. Query = app params (`active=true`, `identifier=clinic|X`,
`_tag=<comma OR of days 1..today>`, `_summary=count`, `_total=accurate`).

| query | result |
|---|---|
| A month names | day1, today, today2 (prev-month + untagged excluded) |
| B month names | stamped, today (prev-month excluded) |
| A / B month count | 3 / 2 (no cross-clinic leakage) |
| A total active | 5 |
| unknown clinic | 0 |
| A `_tag` single today | 2 |

The OR search works live; no change needed there. All fake records deleted (leftover search = 0).
