# Task 717 — Independent Dashboard verification

- [Next.js 16 production checklist](https://nextjs.org/docs/app/guides/production-checklist) and [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) describe the optimized build and request handlers used in the comparison.
- [React 19 useEffect](https://react.dev/reference/react/useEffect) describes when the client starts the tab reads and how Effects clean up.
- [Medplum 5.2.8 client source](https://raw.githubusercontent.com/medplum/medplum/v5.2.8/packages/core/src/client.ts), [Medplum access policies](https://www.medplum.com/docs/access/access-policies), and [FHIR R4 search](https://hl7.org/fhir/R4/search.html#token) cover authenticated resource searches and identifier filters. The actual dev deployment uses Medplum 5.2.15.
- [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/ps3.18.html) covers DICOMweb. The Dashboard comparison exercises queue, appointment and billing paths.
- [W3C Largest Contentful Paint](https://www.w3.org/TR/largest-contentful-paint/) describes the buffered performance entries used to capture the last candidate before interaction.

## Protocol

The comparison uses exact `origin/dev` (`b22d32e`) and the Task 716 PR head (`b141693`). Task 716's measured PR revision (`5f5efd0`) and its published head have identical application source. Both new builds used Next.js 16.4.5 webpack production mode and Chromium via Playwright 1.59.1 at 1440 × 900. Only one Next process group listened on 127.0.0.1:3717 at a time, with a 3072 MiB Node heap cap and dev Medplum on 127.0.0.1:8113.

The first six pairs rotated Dashboard, Inventory and Billing. The final six pairs measured Dashboard alone. Build order alternated `dev → PR` and `PR → dev`. Each block used a fresh browser context with the same fake-clinic session. Each screen warmed once, then contributed three hard navigations with HTTP caching enabled. A buffered `PerformanceObserver` recorded the last LCP candidate through network idle. Dashboard usable time is the first animation frame with a visible queue table. All-data time is the later of usable time and both secondary tab bodies arriving. Response fingerprints and queue row counts check fixture parity across each pair.

The Task 716 table was recalculated from its saved samples. Dashboard, Inventory and Billing medians and interquartile ranges matched the published values. The fresh sample measures the same outcomes independently against the current PR head.
