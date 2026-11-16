# Task 358: independent Task 357 review intake — 2026-11-16

## Repository findings

Read `AGENTS.md`, branch/worktree state, package versions, `e2e/scripts/check-all.sh`, and existing `lib/fhir/pacs-link.ts` / `lib/server/pacs-hosts.ts`. Existing URL sanitization and per-clinic host lookup belong to prior phases; they do not demonstrate phase 3 Orthanc authorization. Task 357 has no implementation commit or matching draft PR. Its untracked WIP remains with its owner.

Next is pinned to 16.2.1 and React to 19.2.6 in this checkout. Medplum package ranges are `^5.1.13`; the requested runtime target is 5.2.8. No new SDK API was used. A version-tagged Medplum source fetch was unavailable, so exact 5.2.8 API verification remains pending with the implementation review.

## Official references consulted

- Orthanc security: https://orthanc.uclouvain.be/book/faq/security.html — remote HTTP access requires authentication and careful endpoint restrictions; its HTTP API permits sensitive archive operations. HTTP authentication does not establish DICOM ingress isolation.
- Orthanc authentication: https://orthanc.uclouvain.be/book/faq/authentication.html
- Orthanc DICOMweb: https://orthanc.uclouvain.be/book/plugins/dicomweb.html — DICOMweb shares HTTP authentication settings.
- OHIF DICOMweb configuration: https://docs.ohif.org/configuration/datasources/dicom-web/ — separate QIDO/WADO service roots must route through the intended protected data source. Current docs are not proof of a particular uncommitted image's behavior.
- FHIR R4 ImagingStudy: https://www.hl7.org/fhir/R4/imagingstudy.html — identifier, basedOn, subject, encounter and endpoint provide distinct linkage semantics.
- DICOM Study Root: https://dicom.nema.org/medical/Dicom/2024c/output/chtml/part04/sect_C.6.2.html — accession `(0008,0050)` and Study Instance UID `(0020,000D)` are distinct matching keys.
- Medplum client: https://www2.medplum.com/docs/sdk/core.medplumclient — searchResources returns resources; exact-version usage must be checked against 5.2.8 when code exists.
- Medplum project access: https://www.medplum.com/docs/access/projects — broad SDK searches must not be assumed to provide application clinic boundaries.
- Next.js authentication: https://nextjs.org/docs/app/guides/authentication — Route Handlers need authorization at the data boundary.
- React useEffect: https://react.dev/reference/react/useEffect — cleanup and asynchronous effects matter for eventual viewer UI integration; no UI changes made here.

## Review boundary

Do not replace the missing builder output with a new phase 3 implementation. Obtain a committed target, then review its actual configuration and request paths. No production inspection or runtime action is needed for this intake. See `.ai/REVIEW-xray-phase3.md` for the unverified checks and HOLD verdict.
