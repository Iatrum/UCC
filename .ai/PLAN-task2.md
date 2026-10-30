# Plan task 2: seed 4 clinics with fake data (builder: Codex)
File: `e2e/scripts/seed-clinics.ts` (run: `cd e2e && npx tsx scripts/seed-clinics.ts`), reuse `e2e/lib/fhir.ts` admin client (local Medplum :8113 only; refuse to run if MEDPLUM_URL is not localhost).
1. Clinics: keep existing `demo`; ensure `kl-sentral`, `pj-damansara`, `jb-larkin` (+demo = 4). For each: Organization + HealthcareService with identifier `clinic|<slug>` (createResourceIfNoneExist), and a PractitionerRole linking the existing test doctor (Practitioner of doctor@ucc.local) to each Organization so the user can switch clinics.
2. Per clinic (new 3 + demo): 6 fake patients (Malaysian-style fake names, fake NRIC `990101-14-xxxx` style ending with an obviously fake serial, phone 012-000xxxx), identifier `clinic|<slug>` + seed identifier `http://iatrum.com/seed|<slug>-p<n>`; then `$set-accounts` (HealthcareService ref, propagate true) like assignResourceToClinicTenant.
3. Per patient: 1-2 finished Encounters (class AMB, serviceProvider = clinic Organization, past dates), 1 Condition (ICD-10 J02.9/ E11.9/ I10 etc.), and for half of them a lab ServiceRequest (FBC LOINC 58410-2, status completed, intent order, encounter ref, requester doctor) with Observation(s) (status final, valueQuantity, referenceRange, basedOn SR) + DiagnosticReport(final, basedOn SR, result refs). Some results high/low via interpretation but NO critical flags.
4. Every resource carries `meta.tag` `{system:'http://iatrum.com/seed', code:'ucc-dummy-v1'}`. Idempotent: rerun creates nothing new (lookup by seed identifier).
5. Print a summary table (counts per clinic) without any secrets.
Accept: run twice -> same counts; `npx tsx scripts/clinic-check.ts` exits 0 with 4 clinics and no cross-clinic patients; full e2e no new failures.
Do NOT modify app code. Do not log passwords/tokens.

## Changes after Claude critique (REVIEW in .ai/REVIEW-task2-plan.md)
- Every seeded resource gets a UNIQUE seed identifier `http://iatrum.com/seed|<slug>-p<n>-<type><k>` used as the createResourceIfNoneExist key (idempotency).
- Clinical resources (Encounter, Condition, ServiceRequest, Observation, DiagnosticReport) ALSO get `clinic|<slug>` identifier; Encounter.serviceProvider = clinic Org. Accounts come from Patient compartment inheritance after `$set-accounts` on the Patient (do $set-accounts BEFORE creating child resources), and re-run $set-accounts propagate at the end to be sure.
- ServiceRequest.category = laboratory (code `108252007`, system http://snomed.info/sct, plus text 'laboratory') — check how the app's search `category: 'laboratory'` matches and copy what `createLabOrder`/existing lab orders in Medplum actually store; read an existing ServiceRequest from the demo clinic first. Use `LAB_TESTS.CBC` values from lib/fhir/lab-constants.ts (copy constants, e2e can't import app alias).
- Doctor Practitioner lookup: `ProjectMembership`/`Practitioner?email=doctor@ucc.local` (telecom) or name=Doctor; PractitionerRole key: search `practitioner=Practitioner/<id>&organization=Organization/<id>` before create.
- Guard: `new URL(MEDPLUM).hostname` must be `localhost` or `127.0.0.1`, else exit 1.
- Confirm demo slug by reading the existing Organization (identifier clinic|demo).
- Write the seed with its own small admin login helper (do not change e2e/lib/fhir.ts, it is the read-only verifier).
