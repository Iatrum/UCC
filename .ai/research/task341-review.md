# Task 341 research — independent review of Task 340

Reviewed PR #246 at 1eb0299, including inherited device-key/X-ray code. Latest task instructions explicitly authorize fetching and normal pushes to the existing PR branch despite the generic AGENTS remote prohibition. Own worktree starts at origin/dev; identity copied from its last author.

Official references checked 2026-11-16:
- [Medplum 5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts): searchResources accepts FHIR search parameters and request options; do not assume a privileged client supplies tenant filtering.
- [Medplum access policies](https://www.medplum.com/docs/access/access-policies): resource restrictions belong in access policy and application authorization.
- [Next.js App Router security](https://nextjs.org/docs/app/guides/data-security): authenticate/authorize server data access. Repo pins Next 16.2.1; no new framework API needed.
- [React common DOM props](https://react.dev/reference/react-dom/components/common): escaped text does not validate a URL passed to window.open; no raw HTML needed. Repo uses React 19.2.6.
- [FHIR R4 ImagingStudy](https://hl7.org/fhir/R4/imagingstudy.html): subject and encounter references are not clinic ownership; series.endpoint is an Endpoint reference, not an inherently trusted viewer URL.
- [DICOM PS3.18 Studies service](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_10.html): DICOMweb retrieval/search/store are separate protocols; this change is an external browser viewer link, with no server fetch or iframe.
- [OWASP redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html): exact allowlisting; downstream redirect behavior of a trusted external host remains its responsibility.
- [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): no server URL dereference here. DNS names can resolve to private IPs, so DNS syntax rejection is not SSRF containment if a proxy is added later.

Findings before fixes: results route verifies the target but ImagingStudy and DiagnosticReport searches lack clinic identifiers; untagged studies bypass URL enforcement and raw series URLs reach window.open. Generic imaging should retain safe http(s) series links, while X-ray links require the clinic allowlist. Regressions must cover patient and encounter searches plus untagged malicious endpoints.
