# Task 765 · Time Chit staff walk

- The existing e2e global setup authenticates the fake practitioner and seeds the usual catalogs without seeding Time Chit. The patient workspace supplies the built-in Time Chit when the clinic catalog has no matching entry. The admin clinic editor builds its module switches from the branch module registry.
- The staff walk uses that existing session and verifies its role with `/api/auth/me`. It creates a fake patient and consultation through the same app routes as the existing Time Chit e2e spec. Signing through Treatment persists the document for the patient's Documents tab. Printing uses a hidden iframe with the same document HTML.
- Medplum's API and the released server versions provide the authentication and FHIR context. The test uses the installed dev server at loopback port 8113. [Medplum API](https://www.medplum.com/docs/api) · [5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [5.2.15 release](https://github.com/medplum/medplum/releases/tag/v5.2.15)
- FHIR R4 defines the visit as an Encounter and the document's app-specific record uses a Procedure linked to that encounter. [Encounter](https://hl7.org/fhir/R4/encounter.html) · [Procedure](https://hl7.org/fhir/R4/procedure.html)
- Next.js supports a loopback-bound dev server on a dedicated port. Playwright frame locators can inspect the preview and the print frame. [Next.js 16 CLI](https://nextjs.org/docs/app/api-reference/cli/next) · [React 19 documentation](https://react.dev/reference/react) · [Playwright frames](https://playwright.dev/docs/frames)
- DICOM PS3.1 scopes DICOM to medical imaging and related data. The Time Chit walk uses the app's clinical document renderer. [DICOM PS3.1](https://dicom.nema.org/medical/dicom/current/output/html/part01.html)

## Pilot evidence

The A7 staff walk passed on dev with fake data in `e2e/tests/time-chit-staff.spec.ts`. A clinic practitioner issued a Time Chit from Treatment, reopened it in Documents, and sent it to the browser print frame. The test also verifies clinic module settings discard the Time Chit identifier. The walk required no app changes or clinic settings writes.
