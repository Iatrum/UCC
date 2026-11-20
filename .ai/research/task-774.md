# Task 774 — Review of Task 773 on PR #355

- [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) and [Medplum client API](https://www.medplum.com/docs/sdk/core.medplumclient). The branch locks the SDK to 5.1.13. The tests exercise real application services with stubbed Medplum methods.
- [Next.js 16](https://nextjs.org/blog/next-16), the [Next.js cache API](https://nextjs.org/docs/app/api-reference/functions/unstable_cache), and [React 19](https://react.dev/blog/2024/12/05/react-19). The clinic-directory tests bypass the cache wrapper to exercise lookup and fallback without a Next.js request.
- FHIR R4 [token search](https://hl7.org/fhir/R4/search.html#token), [Task](https://hl7.org/fhir/R4/task.html), and [DocumentReference](https://hl7.org/fhir/R4/documentreference.html) define the identifier queries, task references, and attachment fields checked by the tests. [DICOM PS3.18](https://www.dicomstandard.org/news-dir/current/docs/cpack109/cp2066.pdf) describes DICOMweb. These tests make no imaging requests.
- [Bun test runner](https://bun.com/docs/test) supports filtering by file path and repeatable randomized runs.

## Review

Reviewed all 17 tests against their service implementations. The fixtures use synthetic identifiers and payloads, a reserved `.invalid` hostname, and stubbed Medplum calls. The document audit failure occurs at a stubbed read before the privileged audit writer is obtained. Checks for generated values are independent of wall-clock time.

The clinic directory fake now selects by identifier, so a wrong or missing identifier changes the lookup result. Billing tests retain assertions on clinic and billing search constraints, foreign-task filtering, returned task data, and resource writes. The document audit test checks that the read was attempted and that registration still returned the created ID. Removed assertions on cache configuration, page size, object identity, and log wording. Only test files and these notes changed.

## Verification

- `bun test tests/unit` passed all 1,399 tests.
- The 17 reviewed tests passed three randomized repeats with seed 774.
- `bun run lint` passed TypeScript and the clinic/admin boundary check. ESLint passed for both edited test files.
- The full E2E gate was skipped because the isolated worktree had no E2E password file or local app configuration. No application server was started.
