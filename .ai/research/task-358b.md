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
