# Task 793 lint cleanup

The base commit is `239510c` from `origin/dev`. The project lint script runs TypeScript with `tsconfig.lint.json` and checks clinic-admin Medplum wiring. The separate ESLint script reports rule diagnostics. The regular TypeScript configuration provides an additional type check. [Next.js 16 linting guidance](https://nextjs.org/docs/app/guides/upgrading/version-16), [TypeScript noEmit](https://www.typescriptlang.org/tsconfig/noEmit.html), [ESLint unused bindings](https://eslint.org/docs/latest/rules/no-unused-vars).

The manifest pins Next.js 16.4.5 and React 19.2.6 and declares Medplum SDK ^5.1.13. The repository rules record Medplum server 5.2.15 on dev. The selected lint fixes use the same default export and heartbeat loop. [React 19](https://react.dev/blog/2024/12/05/react-19), [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8), [FHIR R4](https://hl7.org/fhir/R4/), [DICOM web services](https://dicom.nema.org/medical/dicom/current/output/html/part18.html).

Candidate files must be absent from the open GitHub PR file lists and outside the composer, sidebar, navigation, and POCT code.

The baseline project lint and standalone TypeScript check passed. ESLint reported 2 errors and 9 warnings. Comparing the diagnostic files with the file lists of 13 open PRs left two in-scope warnings. Playwright accepts a named function as the default export of its global setup module. The X-ray simulator's loop already passes ESLint without the suppression. [Playwright global setup](https://playwright.dev/docs/test-global-setup-teardown), [ESLint unused directives](https://eslint.org/docs/latest/use/configure/rules#report-unused-eslint-disable-comments).
