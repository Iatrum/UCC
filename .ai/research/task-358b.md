# Task 358b — MC and referral issuance

Requested base: origin/main (84874a7); explicit task instructions override the supplied default dev/no-remote rules for this branch and one draft PR. Worktree-only changes. No production services or patient data.

## Verified sources
- [Medplum 5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts): executeBatch accepts a FHIR transaction Bundle; conditional POST uses request.ifNoneExist.
- [FHIR R4 DocumentReference](https://hl7.org/fhir/R4/documentreference.html): subject, context.encounter, author, custodian and content.attachment describe the issued artifact. status=current describes the reference; docStatus=final describes the document.
- [FHIR R4 Attachment](https://hl7.org/fhir/R4/datatypes.html#Attachment): data holds base64 binary content, including HTML. Use inline attachment data so the printable snapshot and its metadata commit together, without changing Firebase uploads.
- [FHIR R4 transactions](https://hl7.org/fhir/R4/http.html#transaction): transaction entries succeed or fail together. Replace Procedures and create issued documents in the same transaction.
- [FHIR R4 Binary](https://hl7.org/fhir/R4/binary.html): separate Binary resources have no identifier field. Inline Attachment.data avoids an unscoped extra clinical resource.
- [Next.js App Router](https://nextjs.org/docs/app/getting-started/server-and-client-components): route handlers keep authenticated persistence server-side; interactive viewing remains in the existing client section.
- [React 19 effects](https://react.dev/reference/react/useEffect): cancel stale fetch updates when patient changes/unmounts.
- [DICOM encapsulated PDF](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.45.html): intended for DICOM information objects; these letters are ordinary clinical documents, with no imaging/DICOM changes.

## Existing code
Sign treatment POSTs /api/orders; it calls updateConsultationInMedplum. MC/referral metadata is JSON in Procedure.note; all Procedures were blindly completed. Patient Documents currently regenerates HTML from mutable templates and patient details. Snapshot issuance must use server patient/clinic/signer data, escape free text, preserve optional MC diagnosis, and avoid retroactively issuing historical records.

origin/main has neither e2e/scripts/check-all.sh nor the .ai shared memory files. Record this validation limitation explicitly; never run a different checkout's gate against its application or production defaults.

## Verification findings

- Local TypeScript passes; unit suite now has 28 passing tests.
- API/browser lifecycle verifies saved drafts do not create artifacts, invalid referral blocks the entire issue attempt, MC/referral Sign creates final linked documents, retry creates no duplicates, clinicb cannot list/read/sign demo artifacts, issued copies resist mutation/deletion, patient edits preserve original content, and the existing patient tab previews/prints the stored copy.
- Build initially found that lib/models.ts imports consultation-service in a browser entry. Replaced node:crypto hashing with Web Crypto; production webpack compilation then passed. No changes to the existing shared model architecture.
- Existing Python static suite: 4 passes and 3 failures, identical patient-document failure names to origin/main. Composer label expectations follow the new draft wording.
- The dev fake doctor's newer access policy blocks baseline patient creation on this older base. Lifecycle tests use the local fake admin fixture with explicit demo/clinicb scope; no shared policy modifications.
- Draft PR: https://github.com/Iatrum/UCC/pull/253 (base main). GitHub integration could not create it (403), so the authenticated CLI was used. Repository CI's external credential check fails; do not probe production services to troubleshoot it.

## Local reproduction

Use only a local app backed by MEDPLUM_BASE_URL=http://127.0.0.1:8113. The dedicated Playwright configuration refuses other Medplum targets. Configure UCC_TEST_USER, UCC_TEST_PASSWORD_FILE (ignored local file), and optional UCC_TEST_CLINIC for the local fake admin fixture. Run `timeout 5m bunx playwright test -c tests/playwright.documents.config.ts`. Default app port is 3218. Unit tests: `bun test tests/unit`. Types: `bun run lint`. Build: `bun run build:ci`. Cap NODE_OPTIONS at --max-old-space-size=3072; stop the entire owned server process group afterwards.

Final results: local production build PASS, TypeScript PASS, 28/28 unit tests PASS, 2/2 dedicated API/browser tests PASS. Owned dev server stopped, port 3218 clear. GitHub lint-and-build passed for ba024ac. Credential workflow fails during Playwright browser installation because chromium is unsupported on ubuntu26.04-x64; its site/credential step was skipped. No production troubleshooting performed.
