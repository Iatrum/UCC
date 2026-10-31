# Claude (sonnet) critique of PLAN-task2

## Plan review — `.ai/PLAN-task2.md`

- **BLOCKER** — No unique per-resource identifier is defined for Encounters, Conditions, ServiceRequests, Observations, or DiagnosticReports. Step 4's `meta.tag {code:'ucc-dummy-v1'}` is identical across *every* seeded resource, so it can't be used as a `createResourceIfNoneExist` dedup key. Without a unique identifier (e.g. `http://iatrum.com/seed|<slug>-p<n>-enc1`) per resource, a second run will create duplicates for all of these types, directly breaking the stated acceptance test "run twice -> same counts."

- **MAJOR** — Only Patients get the `clinic|<slug>` identifier / `$set-accounts` call (step 2). AGENTS.md requires "every clinical resource carries its `clinic` identifier." The plan relies implicitly on Medplum's "new resources in a Patient compartment inherit accounts" behavior (noted in the research doc) to cover Encounter/Condition/ServiceRequest/Observation/DiagnosticReport, but this is never stated as the mechanism, and `resourceMatchesClinicTenant` (lib/fhir/clinic-tenancy.ts:124) also checks `identifier`/`serviceProvider` directly — these resources won't match on that path. Should be explicit: either add `clinic|<slug>` identifiers to these resources too, or explicitly document "inherits via compartment, verified by X."

- **MAJOR** — Plan's ServiceRequest/DiagnosticReport spec omits `category`. `getPatientLabOrders` (lib/fhir/lab-service.ts:277) filters on `category: 'laboratory'`, but the existing `createLabOrder()` helper never sets that field either — so copying that pattern risks seeding lab orders that are invisible to the exact query the Lab tab likely uses. Plan should call this out and set `category` explicitly rather than silently reproducing a possibly-latent bug.

- **MAJOR** — Step 1's PractitionerRole linking is underspecified: no lookup strategy for finding the existing `doctor@ucc.local` Practitioner (no `telecom`/identifier search param named), and no dedup key stated for the PractitionerRole `createResourceIfNoneExist` call (e.g. `practitioner=X&organization=Y`). Builder is left to guess both.

- **MINOR** — Plan calls the panel "FBC" but `lib/fhir/lab-constants.ts:7` defines it as `LAB_TESTS.CBC` ("Complete Blood Count (CBC) panel", `58410-2`). Plan should reference `LAB_TESTS.CBC` directly instead of hand-rolling code/display/system, to avoid drift from the single source of truth.

- **MINOR** — `e2e/lib/fhir.ts` is explicitly commented "Read-only FHIR verification against the local Medplum" and only exports `fhir()` + `byPatient()`. Reusing it as the seed script's write/admin client works mechanically but contradicts its documented scope — either update the comment or keep the seed script's Medplum login/admin logic local to `seed-clinics.ts` instead of overloading that module's stated purpose.

- **MINOR** — The "refuse to run if MEDPLUM_URL is not localhost" guard has no existing helper to reuse (`e2e/lib/env.ts` just reads the env var with no validation). Plan should spell out the exact check (e.g. hostname must be `localhost`/`127.0.0.1`) so it isn't skipped or implemented loosely.

- **MINOR** — Plan assumes the existing demo clinic's slug/identifier value is exactly `demo`, based on the research note's reference to an external `/workspace/ucc-medplum/seed.mjs` (not accessible from this working directory to verify). Worth confirming the actual `clinic|<value>` identifier on the existing demo Organization before the seed script assumes it, to avoid accidentally creating a 5th duplicate clinic.
