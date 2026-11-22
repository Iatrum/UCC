# Task 792 — independent review of Task 791

The saved five-run before/after outputs on the VPS reproduce all ten medians in PR #370. Both have the same screen order and output format from `perf-screens.mjs`. The metric starts before a full document navigation and ends when the per-screen marker is visible and the skeleton selector is absent. Some markers are headings, so the metric can stop before data finishes loading. The script reports network-settled timing separately. The builds and request-start trace were not rerun for this review.

| Patients list | Five warm visible samples (ms) | Median (ms) |
| --- | --- | ---: |
| Before | 609, 594, 571, 671, 544 | 594 |
| After | 553, 1136, 546, 490, 543 | 546 |

The 48 ms difference falls within the variation on unchanged screens. Appointments also moved from 428 to 292 ms, and analytics from 590 to 260 ms. These measurements do not isolate a visible-content speedup.

The authenticated route layout still gates page entry. The list, search and stats requests still use the session cookie and the unchanged patient API, which checks clinic assignment and supplies the clinic identifier to the FHIR queries. The source diff is limited to the patients page and benchmark script. The fresh-login benchmark does not cover token expiry. Overlapping requests can refresh the same cookie; the pinned Medplum token handler permits recent rotation retries from the same IP.

- [Next.js 16 App Router data fetching](https://nextjs.org/docs/app/getting-started/fetching-data)
- [React 19 effects](https://react.dev/reference/react/useEffect)
- [Playwright navigation milestones](https://playwright.dev/docs/api/class-page#page-goto)
- [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) and [refresh-token handler](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/token.ts#L380-L440)
- [FHIR R4 search](https://hl7.org/fhir/R4/search.html)
- [DICOM standard overview](https://dicom.nema.org/medical/dicom/current/output/html/part01.html)
