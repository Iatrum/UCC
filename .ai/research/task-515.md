# Task 515 — X-ray UX on Labs & Imaging

- Study card (components/imaging/imaging-results-view.tsx): 4-col grid let the long accession spill into Series and the "Open images" button overflow. Now: accession column wider (`minmax(0,2fr)`), `min-w-0` + `truncate` + `title` tooltip, viewer/PACS buttons on their own full-width row with `max-w-full`.
- Route /patients/[id]/labs-imaging: `ImagingOrderForm` posts to /api/imaging/order without `xray`, so no accession is minted (see lib/fhir/imaging-service.ts createImagingOrder; composer sends `xray: {code, deviceId, entryId}`).
- Decision: smallest safe option — hide the form when the `pacs` module is enabled (`isModuleEnabledForClinic`) and show a pointer to the Treatment panel. When pacs is off the generic imaging form stays (module-independent clinic feature, see e2e/tests/module-toggle.spec.ts). No nav changes.
- Docs: Next.js 16 async `params` already used; server component calls existing module helper.
