# Task 561 — review of #308 (analytics redesign + #310 folded in)

Head reviewed: 469c321. Verdict: **APPROVE**, no code changes needed.

- Redesign intact: `components/analytics/*` (Ringkasan/Klinikal/Duit & Operasi) and `lib/analytics/{queries,aggregate,range}.ts`; #310 only added a test, notes and `.ai/PILOT-CHECK.md`.
- Revenue: headline uses the checkout Invoice total (= sum of quantity x unit price over all lines, incl. lab/imaging, see `buildLineItem`/`completeCheckoutInvoice`). Source split uses line amounts. `tests/unit/task558-analytics-revenue.test.ts` covers qty + lab lines (65 total).
- Consultations: counted from clinic-scoped Encounters by date, not intersected with a patient list; test with 450 patients passes.
- Clinic isolation: every `searchBounded` adds `identifier=clinic|<id>` and re-filters with `resourceMatchesClinicTenant`; every `count()` call passes a clinic identifier; cache keys are prefixed by clinicId.
- Bounded: date windows, `_elements`, hard page caps (3-6 x 1000) with a `truncated` flag, `_summary=count` for counts, TTL cache.
- No result values (Observation/DiagnosticReport) are read; orders are counts only. No composer/sidebar/nav changes.
- Checks: `tsc --noEmit` clean; `bun test tests/unit` 684 pass / 0 fail; #308 MERGEABLE/CLEAN, contains origin/dev; #310 CLOSED with "Folded into #308".
- Note (non-blocking): truncation at the page caps is only flagged, not paged further; the age/gender chart already uses count queries (not the 300-patient list).
