# Task 564 - exact age/gender + most-dispensed date field

## Age/gender
- The rebuilt analytics (Task 551) no longer reads patients at all: `getClinical` issues 8 `Patient?_summary=count&_total=accurate` queries
  (4 age buckets x male/female), each filtered by `active=true`, the clinic identifier and `birthdate` ranges (gt/le cutoffs, contiguous, no overlap).
  Cached 5 min (`SLOW_CACHE_MS`). So the "newest 300 patients" note in PILOT-CHECK/review 559 referred to the pre-redesign page and is obsolete; no code change needed.
- Unit test pins: 8 count-only queries, clinic identifier on each, bucket cutoffs.
- Known limit: gender `other`/`unknown` and patients without birthDate are not in the chart (same as before).

## most-dispensed: whenhandedover
- Medplum 5.2.8 dev (127.0.0.1:8113, fake data): `SearchParameter` `whenhandedover` base MedicationDispense, expression `MedicationDispense.whenHandedOver` (type date).
- Live checks: `whenhandedover=ge2000-01-01` = 32/32 dispenses; `ge2026-11-17` (21) + `lt2026-11-17` (11) = 32, so ranges filter correctly; `+08:00` offsets work; combines with `status=completed`.
- Writer: `lib/fhir/dispense-service.ts:280` sets `whenHandedOver` at finalisation when quantity > 0 (zero-quantity lines contribute 0 anyway).
- Switched the query from `_lastUpdated` (which moves on any later edit/void) to `whenhandedover`. Ref: https://hl7.org/fhir/R4/medicationdispense.html#search
