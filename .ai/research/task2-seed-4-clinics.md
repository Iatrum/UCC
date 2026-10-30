# Task 2 research: dummy-data seed for 4 clinics

## How UCC models a clinic (code, 2026-10-31)
- Clinic = `Organization` + `HealthcareService` ("account"), both with identifier `clinic|<slug>` (lib/fhir/clinic-tenancy.ts, /workspace/ucc-medplum/seed.mjs).
- Staff access = `PractitionerRole{practitioner, organization, active}` (assertClinicAssignment in lib/server/medplum-auth.ts).
- Patients carry identifier `clinic|<slug>` (withClinicIdentifier) and `meta.accounts` = HealthcareService/<id> via `$set-accounts` with `propagate:true` (assignResourceToClinicTenant).
- Clinic chosen on localhost from the login/session clinic cookie (lib/server/clinic.ts).
- Lab orders = ServiceRequest; results = Observation + DiagnosticReport (lib/fhir/lab-service.ts).

## Medplum docs
- `$set-accounts`: sets meta.accounts, `propagate` updates the Patient compartment (<=1000 resources); needs explicit permission. https://www.medplum.com/docs/api/fhir/operations/set-accounts
- New resources in a Patient compartment inherit the Patient's accounts automatically; explicit `meta` on update can overwrite them. https://linen.medplum.com/t/28540608/accounts-vs-compartments
- Multi-tenant access control (Organization/HealthcareService tenants). https://www.medplum.com/docs/access/multi-tenant-access-policy
- Idempotent create: `createResourceIfNoneExist(resource, 'identifier=sys|val')`. https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist

## FHIR R4
- Observation.status 1..1; Encounter.status 1..1 + class 1..1; ServiceRequest status/intent/subject 1..1; DiagnosticReport status/code 1..1. https://hl7.org/fhir/R4/

## Pitfalls
- Medplum auth rate limit (~5/min/IP): log in once (admin) and reuse the client.
- Keep the existing `demo` clinic and its data; new clinics are additive. All names are fake; NRIC-like ids use an obviously fake pattern; tag every seeded resource `http://iatrum.com/seed|ucc-dummy-v1` so it can be found/removed.
