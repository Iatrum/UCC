# Task 666 research

- Next.js App Router server rendering can start clinic-scoped reads before hydration. Lazy loading a Client Component defers its code until it is rendered. [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data) · [Lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)
- React 19 transitions leave controlled input state urgent. Updates scheduled after an asynchronous catalog load can be wrapped in `startTransition` at the point where the data is applied. [React `startTransition`](https://react.dev/reference/react/startTransition)
- The queue uses an authorized Medplum client with a clinic identifier and tenant checks. Appointments use both `actor` and `identifier`. [Medplum 5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts) · [Medplum search](https://www.medplum.com/docs/search/basic-search) · [FHIR R4 search](https://hl7.org/fhir/R4/search.html) · [Appointment parameters](https://hl7.org/fhir/R4/appointment.html#search)
- DICOM service paths are outside the follow-up diff. [DICOM PS3.18 scope](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_1.html)

## Reproduction

The requested refs resolve to `46488f8` (before), `fbdc693` (fetched `origin/dev`) and `e072e57` (fetched `origin/claude/perf-591`). The follow-up branch already includes `fbdc693`.

The Task 665 Playwright script was recovered from the VPS. The original SHA-256 was `6a5ffb14e894df25b936064a12b13aac810e7a431b1bca3d98291e04fedd2a0e`. The only script change for the rerun was the loopback port, from `3665` to `3666`. Each build used its frozen lockfile, Playwright 1.59.1, `next build --webpack` and `next start`. Runs used the same dev Medplum on `127.0.0.1:8113`, one Chromium context per version, one login, an untimed warm-up and five measured runs per route. The Task 665 catalog request observer ran on the two follow-up builds.

The first two attempts on `46488f8` timed out at the Treatment warm-up. A separate diagnostic confirmed all three existing billable visits offered by that build opened the Consult drawer with “Consult Required” after hydration. The old profile reads a single clinic-wide page of encounters and can miss a patient's consultation. One new fake visit went through the normal registration, check-in and consultation APIs and became the first billable result. The comparison reran with that shared fake visit and the original fixture discovery, readiness selectors and timings. The fixture therefore differs from the earlier 19 Nov snapshot.

While the pinned benchmark ran, `dev` advanced to `12df445` through #326 and #328. The local merge retained both changelog entries at the only conflict. Keep the pinned three-commit comparison distinct from the final branch build, which includes those upstream changes. In particular, #326 changes an optional invoice lookup in checkout.

## Results

Each cell shows **usable min / median / max · median LCP / document TTFB**, in ms.

| Route | Before `46488f8` | Pinned dev `fbdc693` | `claude/perf-591` at `e072e57` | Task 666 with dev `12df445` |
| --- | ---: | ---: | ---: | ---: |
| Login to dashboard | 1225/1225/1225 · 152/27 | 1983/1983/1983 · 336/54 | 951/951/951 · 164/29 | 1885/1885/1885 · 524/78 |
| Dashboard and queue | 824/1053/1385 · 468/59 | 531/753/1359 · 244/74 | 414/598/635 · 508/95 | 596/726/1004 · 612/137 |
| Patients list | 424/483/610 · 408/69 | 244/341/514 · 200/108 | 186/253/370 · 148/53 | 272/369/384 · 220/96 |
| Patient profile | 574/691/1538 · 624/141 | 480/650/801 · 588/94 | 279/442/734 · 272/86 | 447/527/1010 · 520/113 |
| Profile to Treatment search | 958/1107/1871 · 932/127 | 732/800/939 · 468/112 | 875/1166/1217 · 596/80 | 553/609/1032 · 420/35 |
| Billing | 1153/1397/1459 · 1148/104 | 366/503/549 · 448/68 | 644/811/1140 · 780/157 | 439/559/604 · 464/57 |
| Checkout | 1128/1452/1608 · 1288/30 | 517/1003/1017 · 560/13 | 1134/1181/1678 · 980/28 | 1043/1147/1434 · 868/23 |
| Inventory | 476/508/794 · 432/19 | 325/380/429 · 316/14 | 481/551/604 · 540/56 | 558/582/787 · 584/70 |
| Analytics | 1410/1776/1893 · 956/45 | 931/1091/1578 · 288/21 | 1184/1388/1545 · 636/23 | 1407/1415/1591 · 464/27 |

Treatment click to editable search, excluding profile navigation, had medians of 158, 267, 350, 192 ms in the same order.

- Dashboard and queue took 598 ms on the original follow-up and 726 ms in the final build. The final minimum was 596 ms. The recovered harness also measured the before commit at 1,053 ms with the shared fake visit and at 708 ms in Task 665's earlier snapshot. It did not reproduce the supplied 342 ms target. The server-rendered queue removes a post-hydration request on success and puts the authorized queue read on the document render path. The final dashboard's median TTFB was 137 ms and LCP was 612 ms, compared with 74 ms and 244 ms on the pinned dev. The harness measures the whole readiness path and cannot isolate the cost of each part.
- The final profile median was 527 ms against 650 ms on pinned dev and 512 ms in the earlier 19 Nov before column. Profile to editable Treatment search was 609 ms against 800 ms on pinned dev and 717 ms in the earlier before column. The Treatment click alone was 192 ms against 267 ms on pinned dev and 138 ms in the earlier before column. Both follow-up runs checked that all five catalogs started after Treatment opened and that the search input was editable. The end-to-end improvement did not reproduce on the original Task 665 commit in the fresh comparison.
- The final billing, checkout, inventory and analytics medians were 559, 1,147, 582 and 1,415 ms. The earlier 19 Nov before column was 585, 1,051, 520 and 1,479 ms, respectively. Current pinned dev in the fresh run was 503, 1,003, 380 and 1,091 ms. Billing and analytics beat the earlier before column. Checkout and inventory did not. All four were slower than pinned dev in the fresh comparison. The same code gave different medians even before the fake visit refresh, and current `dev` advanced before the final run. The data show missing timing gains and do not establish a code-level cause for the slower runs.
- Login has one sample. The other measurements have five warm samples. Readiness is the original benchmark's visible sentinel per route. Billing, Checkout and Inventory sentinels can appear before all asynchronous page data settles. Analytics includes Playwright's network-idle window. The measured time includes local browser and shared VPS scheduling.
