# Task 707 — Independent review of Task 706

- Next.js 16 recommends measuring with `next build` and `next start`. The repository uses its webpack build script and pins Next.js 16.4.5. [Production guide](https://nextjs.org/docs/app/guides/production-checklist)
- React 19 documents request waterfalls from Effects and cleanup when their dependencies change. [React useEffect](https://react.dev/reference/react/useEffect#fetching-data-with-effects)
- Reviewed the requested Medplum 5.2.8 reference. The loopback server's health check reported 5.2.15 and the application lockfile pins the SDK to 5.1.13. Medplum access policies apply resource criteria to searches. [5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [Access policies](https://www.medplum.com/docs/access/access-policies)
- FHIR R4 token searches can match identifiers by system and value. [FHIR R4 search](https://hl7.org/fhir/R4/search.html#token)
- The dashboard change has no DICOMweb interaction. [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/PS3.18.html)
- Chromium measures LCP using a buffered performance observer across each full navigation. [Largest Contentful Paint](https://www.w3.org/TR/largest-contentful-paint/)
