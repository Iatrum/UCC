# Task 773 — Clinic, billing and document unit coverage

The fetched PR head `cb5a711` already included `origin/dev` at `51805cf`. Bun LCOV on that head passed all 1,382 unit tests. The clinic validation module was absent from the report. Billing exception tasks and patient documents were the lowest-covered billing and document service modules.

- Medplum's [5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) gives the requested server-version context. The branch locks the SDK to 5.1.13. Its [client API](https://www.medplum.com/docs/sdk/core.medplumclient) and [search guide](https://www.medplum.com/docs/search/basic-search) describe the client methods and query options used by these helpers.
- FHIR R4 defines [token searches](https://hl7.org/fhir/R4/search.html#token) using `system|value`. A billing [Task](https://hl7.org/fhir/R4/task.html) tracks workflow status and can reference an [Invoice](https://hl7.org/fhir/R4/invoice.html) as its focus. A [DocumentReference](https://hl7.org/fhir/R4/documentreference.html) records document metadata and carries the external URL in a content attachment.
- The [Next.js 16 release](https://nextjs.org/blog/next-16) and [testing guide](https://nextjs.org/docs/app/guides/testing) describe framework and unit-test scope. The [unstable_cache reference](https://nextjs.org/docs/app/api-reference/functions/unstable_cache) documents the callback, cache key and revalidation options. Clinic validation tests capture the callback so they can run without a Next.js request or cache.
- [React 19](https://react.dev/blog/2024/12/05/react-19) and [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) cover the UI and DICOMweb context. The selected helpers exercise no React components or DICOMweb calls.

## Results

Added 17 tests for exact clinic-directory queries and fallback, billing follow-up deduplication, scoped pagination and status transitions, and document registration and failure handling. No application code changed.

| Module | Baseline lines | Updated lines |
| --- | ---: | ---: |
| `lib/server/clinic-validation.ts` | No LCOV entry | 100% (25/25) |
| `lib/fhir/billing-task-service.ts` | 76.2% (99/130) | 98.5% (128/130) |
| `lib/fhir/document-service.ts` | 79.6% (86/108) | 99.1% (107/108) |

Verification passed for all 1,399 unit tests, TypeScript, ESLint on both test files, and the clinic/admin client check. The full E2E gate invokes Playwright and was skipped under the task's unit-only scope.
