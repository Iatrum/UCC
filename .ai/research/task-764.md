# Task 764 — PR #357 merge conflict resolution

The PR branch changes the React consultation draft hook and shared notes. The merge preview identifies conflicts in the changelog and decisions log where the two branches added entries at the same location. Preserve each branch's entries and the draft hook change.

- [React 19](https://react.dev/blog/2024/12/05/react-19) and the [React refs lint rule](https://react.dev/reference/eslint-plugin-react-hooks/lints/refs) document the render-time state and ref behavior behind the PR's hook change.
- The [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) documents the ESLint CLI and App Router type generation.
- Reviewed the [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8), [FHIR R4 REST API](https://hl7.org/fhir/R4/http.html), and [DICOM PS3.18](https://dicom.nema.org/medical/dicom/2026b/output/html/part18.html). The merge resolution is confined to documentation and preserves the existing integration code from each parent.
