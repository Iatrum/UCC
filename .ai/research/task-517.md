# Task 517 — Task 516 review follow-ups (PR #290)

- (a) `POST /api/imaging/order`: with the pacs module on, a request with no `xray` block AND no `encounterId` (the stand-alone labs-imaging form and /pacs/new) is rejected with 409 and a pointer to the Treatment panel. Module off: unchanged. Lookup error: propagates to `handleRouteError` (5xx, fail closed). Composer paths are untouched: X-ray entries send `xray` (accession minted in `createImagingOrder`), and the composer's generic catalog-imaging entries send `encounterId` so they still work.
- Finding (not changed, out of scope): the composer's generic `kind: "imaging"` entries (patient-profile-workspace.tsx) still create orders without an accession even with pacs on. Rerouting them needs a composer change; left for a separate task.
- Finding: `/pacs/new` posts without xray/encounter, so with pacs on it now shows the 409 message instead of creating an accession-less order.
- (b) labs-imaging page: `resolveImagingOrderEntryMode` (lib/imaging/order-entry.ts) fails closed; a lookup error shows the Treatment-panel pointer.
- (c) Tests (tests/unit/task515-xray-ux.test.ts): source-string tests replaced by behaviour tests (route handler with fakes; mode resolver incl. throwing lookup). The imaging-service mock delegates to the real function after the file finishes, because bun `mock.module` leaks into later files.
