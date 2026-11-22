# Task 795 unit-test research

- The FHIR R4 Device resource supplies `identifier`, `status`, `type`, and `property`. FHIR identifies a business identifier by its system and value. The `clinic` system, device coding systems, and heartbeat convention are UCC-specific. [FHIR R4 Device](https://hl7.org/fhir/R4/device.html), [FHIR R4 Identifier](https://hl7.org/fhir/R4/datatypes.html#Identifier)
- Medplum serves FHIR R4. The requested 5.2.8 release was reviewed. The checkout's Bun lockfile resolves the client SDK and FHIR types to 5.1.13. The tests call the helpers directly with in-memory resources. [Medplum 5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8), [Medplum API](https://www.medplum.com/docs/api)
- The two helpers project plain Device objects. Bun can exercise them directly with TypeScript fixtures and a fixed clock. [Next.js 16 testing guide](https://nextjs.org/docs/app/guides/testing), [React 19](https://react.dev/blog/2024/12/05/react-19), [Bun test runner](https://bun.com/docs/test)
- The X-ray helper tested here uses FHIR device metadata. DICOM defines the imaging protocol used elsewhere. [DICOM PS3.1](https://dicom.nema.org/medical/dicom/current/output/html/part01.html)

`lib/fhir/poct-device.ts` and `lib/fhir/xray-device.ts` each export a `deviceForClinic` helper. The inventory and checkout candidates already had unit coverage. Searches of `tests/unit` found no direct tests for either device helper. `gh pr list` returned 15 open PRs with complete file lists and neither helper file appeared in them.

Cover clinic identifiers, device type, and the online rules for active devices, including the 90-second cutoff and missing, malformed, or future heartbeats.
