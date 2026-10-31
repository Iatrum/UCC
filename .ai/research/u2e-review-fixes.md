# U2e review fixes

- Review: `/workspace/ai-logs/codex-u2cde-rev.out`, u2e section.
- Confirmed `lib/fhir/patient-client.ts` maps absent DOB strings to Invalid Date; both appointment pickers previously serialized without checking getTime(). Shared `appointmentDob` checks getTime() before serialization and returns undefined for invalid/missing DOBs.
- Registration input now retains manual ownership in a ref, independently of its value and last automatic DOB. Its tested eligibility helper prevents an empty manual value or a manually matched NRIC DOB from being overwritten.
- Full-date validation rejects year 0000 while retaining year 0001 and leap-day checks.

References verified before implementation:
- https://react.dev/reference/react/useRef — refs retain mutable values across renders; event handlers/effects can use them for ownership without triggering rendering.
- https://hl7.org/fhir/R4/datatypes.html#date — FHIR R4 date rules exclude year zero.
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString — invalid dates throw RangeError; serialization uses UTC.

Scope: no Next.js or Medplum API changes, clinical-resource writes, or composer changes. No dev server, e2e, check-all, commit, or remote operations per explicit user instruction.

Validation: `bun run test:unit` passed (12 tests, 56 assertions). `bun run lint` passed (exit 0). `git diff --check` passed.
