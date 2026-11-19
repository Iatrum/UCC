# Task 702: registration duplicate lookup scoped at the source (combines 700 + 701)

- Gap from Task 701: `findPatientByNric` (lib/fhir/patient-service.ts) searched `nric|X` and `ic|X` across all clinics with the admin client, then filtered with `matchesClinic`. Foreign-clinic patients were therefore read.
- Fix: when a clinic is given, each identifier system is searched three times, each AND-ed with a clinic scope: `identifier=clinic|<id>`, `organization=<org refs>`, `_compartment=<org/account refs>`. Medplum supports `organization` (Patient.managingOrganization), `_compartment` and repeated `identifier` params (AND). Query string form is used because an object cannot repeat `identifier`; a comma means OR in FHIR.
- Legacy patients (no clinic tag) stay found via managingOrganization/compartment refs, as `matchesClinic` defines ownership (ref id equals clinic id, or the tenant org/account refs). `matchesClinic` remains as defence in depth, so results can only be narrower than before.
- Admin client with no clinic id keeps the unscoped lookup (unchanged).
- Tests: tests/unit/task700-clinical-routes.test.ts (legacy via managingOrganization and compartment return 409; every Patient search is scoped and never contains the foreign clinic). mock-medplum now supports string queries, `organization`, `_compartment` and records `searches`.
- Not verified against the live dev Medplum AccessPolicy (unit level only).
- Unit run: 1 failure (`generateSlotsForSchedule > refuses a schedule that belongs to another clinic`), also failing on origin/dev.
- Docs: https://www.medplum.com/docs/search/basic-search · https://hl7.org/fhir/R4/search.html
