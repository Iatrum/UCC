# Task 665 — Dashboard queue, patient profile and Treatment load times

## Research

- The dashboard already fires its three client requests concurrently after client authentication. The initial queue still waits for the dashboard JavaScript and session bootstrap before clinic-scoped FHIR reads can start. A Server Component can run the existing queue query directly with page authorization. The first clinic-filtered Encounter page and clinic tenant resolution can run in parallel. Keep the client loader for fallback, polling and manual refresh. [Next.js 16 data fetching](https://nextjs.org/docs/app/getting-started/fetching-data) · [Next.js backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)
- Patient Profile imports the Tiptap notes editor even when Consult is closed. The Treatment composer is already split, and its search input already accepts typing while data loads. Defer the notes editor until Consult is mounted and schedule catalog loading from the mounted Treatment composer, with cleanup on close. [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading) · [React 19 effects](https://react.dev/reference/react/useEffect) · [Idle callback scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- Keep the existing authorized Medplum client, tenant checks and scoped FHIR search rather than duplicating them for the dashboard. [Medplum v5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts) · [FHIR R4 REST search](https://hl7.org/fhir/R4/http.html#search)
- The profile starts authentication and clinic resolution together. Its Appointment search now uses both the patient actor and the clinic identifier. [FHIR R4 Appointment search parameters](https://hl7.org/fhir/R4/appointment.html#search)
- [DICOM PS3.18 web services scope](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_1.html)

GitHub reports PR #317 as merged at head `fe3c0ad`. Current `origin/dev` is `fbdc693` and contains that head via merge commit `603a49b`. The working tree starts at `fbdc693`.

## Benchmark method

The original harness was unavailable. The replacement used headless Chromium (Playwright 1.59.1), one `next build --webpack` and `next start` per checkout, and each checkout’s frozen lockfile. One server at a time used port `3665` and a 3072 MB Node heap cap. All builds used the same local fake-data Medplum on port `8113`. A fresh browser signed in once per version as the E2E clinician. Patient and consultation IDs came from the browser-session APIs.

Each route had an untimed warm-up followed by five measured runs. Usable time started at document navigation. Treatment included opening the drawer and finding an editable search input, with click-only timing also recorded separately. Dashboard waited for the heading, queue tab, and any queue loading state to clear. Patients waited for the heading and patient summary/table. Billing waited for its heading and Ready for Billing, Checkout for Invoice, Inventory for its heading, and Analytics for its heading and a card/tab followed by network idle. Login to dashboard was measured once from the sign-in click. Its LCP and TTFB are for the login document because the dashboard transition is client-side.

The verification instrumented the fixed profile and Treatment requests outside the usable timing and checked that the five catalog requests only ran after Treatment opened.
Each cell shows **usable min / median / max · median LCP / document TTFB**, in ms.

| Route | Before `46488f8` | Current dev `fbdc693` | `claude/perf-591` with Task 665 |
| --- | ---: | ---: | ---: |
| Login to dashboard | 1042/1042/1042 · 220/33 | 937/937/937 · 156/27 | 910/910/910 · 120/28 |
| Dashboard and queue | 618/708/862 · 368/27 | 487/579/585 · 100/26 | 401/484/523 · 424/87 |
| Patients list | 334/384/547 · 348/50 | 277/298/326 · 176/77 | 248/307/343 · 156/64 |
| Patient profile | 310/512/1040 · 488/145 | 444/563/586 · 544/62 | 390/511/538 · 480/83 |
| Profile to Treatment search | 525/717/795 · 532/75 | 629/713/848 · 492/61 | 496/577/914 · 424/30 |
| Billing | 373/585/1060 · 564/66 | 349/368/381 · 352/68 | 389/425/535 · 404/65 |
| Checkout | 1032/1051/1081 · 660/14 | 776/1026/1155 · 756/14 | 566/578/1106 · 580/19 |
| Inventory | 386/520/1048 · 388/15 | 325/424/460 · 384/32 | 320/354/481 · 352/28 |
| Analytics | 1324/1479/1503 · 836/15 | 1039/1135/1214 · 184/33 | 989/1020/1164 · 208/19 |

Treatment click to editable search, excluding profile navigation, had medians of 138, 194, 138 ms in the same order.

The dashboard cut 95 ms from the current dev median and 224 ms from the fresh pre-#306 rerun. Its 484 ms median remains above the 342 ms target in the earlier report. The server-rendered queue raises document time and LCP on this run while removing the post-hydration queue read from the success path. Profile returned to the fresh pre-#306 median. Treatment improved by 136 ms against current dev and reached 577 ms.

Checkout, inventory and analytics beat both comparison builds on usable median. Billing retained a 160 ms improvement over the fresh pre-#306 build and was 57 ms slower than current dev on this pass. The patch only changes the Billing tab inside Dashboard through the server-rendered queue boundary. The standalone billing route and billing service use the same source as current dev.

## Verification

- TypeScript and changed-file ESLint passed. The 86 focused queue, triage, composer catalog and appointment tests passed.
- Full unit suite had 1,028 passing and two failing tests. The same failures also reproduced on current dev (1,027 passing): foreign-clinic invoice void/delete and foreign-clinic schedule slot generation.
