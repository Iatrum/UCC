# Task 762 — PR #350 conflict resolution

The merge preview showed conflicts only in the changelog and decisions log. The resolution retains the CSRF origins entries for Tasks 732–733 and the slot-generation clinic test entries for Task 727. The CSRF helper, Next.js proxy, and unit tests merged cleanly.

- [Next.js 16 Proxy reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) documents the request proxy and its `NextRequest` argument.
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) document Actions and the associated UI APIs. The PR does not modify React components.
- [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) and [FHIR R4 Security](https://hl7.org/fhir/R4/security.html) provide version and REST security context. The merge resolution does not modify Medplum or FHIR calls.
- [DICOM PS3.18 Web Services](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) defines DICOMweb. The merge resolution does not modify DICOM routes.
