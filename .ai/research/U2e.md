# U2e — Malaysian registration DOB

Read AGENTS.md and UX-FINDINGS.md (currently only a heading). Active registration and legacy new-v1 share the new DOB input. Dashboard Register routes to /patients/new or its scan page; no separate DOB form. Scan passes NRIC to registration. No existing NRIC gender derivation convention found; leave gender manual.

Official references checked:
- https://react.dev/reference/react-dom/components/input — controlled input value/onChange and forwarding native input props.
- https://nextjs.org/docs/app/getting-started/server-and-client-components — interactive inputs stay in client components.
- https://hl7.org/fhir/R4/datatypes.html#date — retain ISO date for storage.
- https://www.medplum.com/docs/api/fhir/resources/patient — birthDate remains FHIR date.

Complete formatted or unformatted NRIC only; century boundary uses current two-digit year per task. Reject rolled-over dates. Manual DOB input displays dd/mm/yyyy; completed valid input becomes ISO form state; invalid/incomplete input fails schema validation. Track autofill ownership so NRIC changes preserve manual DOB, with a mismatch warning.

appointments/new uses appointments-slots-pilot and selects existing patients, with no registration/DOB entry. Display selected patient's stored DOB in dd/mm/yyyy there and in the alternate new appointment form. Scheduling controls unchanged.

e2e/tests/workflow.spec.ts register step fills NRIC and relies on automatic DOB; it does not fill DOB directly in this checkout. Names/selectors unchanged; no e2e edits needed. No dev server, e2e, check-all, commit, or remote actions per user instructions.
