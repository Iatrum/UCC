# Task 770 — Review of Task 769

PR #360 changes scheduling tests and notes. The slot-generation route takes the clinic from `requireClinicAuth` and delegates to `generateSlotsForSchedule`. The service checks the clinic in the schedule's practitioner identifier and the separate tenant marker before querying or writing slots. A failed check raises `ForbiddenError`, which the route error handler maps to HTTP 403.

- FHIR R4 defines `Schedule.identifier` and the reference from `Slot.schedule` to `Schedule`. [Schedule](https://hl7.org/fhir/R4/schedule.html) · [Slot](https://hl7.org/fhir/R4/slot.html)
- Medplum documents system-qualified identifier searches. [Basic search](https://www.medplum.com/docs/search/basic-search) · [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8)
- The Next.js App Router passes Web API requests and responses through Route Handlers. [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) · [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) · [React 19](https://react.dev/blog/2024/12/05/react-19)
- DICOM PS3.18 covers imaging web services. Slot generation uses the FHIR resources above. [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html)

The Task 769 fixture sets both identifiers to the foreign clinic. Two additional fixtures each mismatch only one identifier so the test catches the loss of either guard. Each case expects `ForbiddenError` and verifies that the service neither searches nor writes slots.

`bun test tests/unit` passed all 1,322 tests. `tsc --noEmit` and `bun run lint` passed. The PR head already contains the reviewed `origin/dev` commit `51805cf`.
