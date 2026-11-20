# Task 735 review of Task 734

**Verdict: approve with the Billing fix in this branch.**

Task 734 reproduced successful Playwright runs on `dev` with both versions of the spec. The reported failures remain unexplained. The Task 727/728 branch lacks the exact text locators scoped to their tab panels, so a duplicate Next.js development overlay message remains a plausible cause.

The mocked HTTP 500 tests exercise the dashboard's existing error state, including visible error copy, the absence of empty-state copy, and recovery after Retry. Those assertions remain intact. The clinic-scoped Appointments reader propagates Medplum search failures to its route handler, which allows the panel to show Retry when the request fails.

The real Billing endpoint had a gap. Its helper swallowed failed Medplum reads, including the batched Patient lookup, so the endpoint could send HTTP 200 with an empty list during a backend failure. The Billing endpoint now opts in to error propagation and returns a generic message for internal failures. This activates the existing Billing error state and Retry. The Orders page keeps its existing fallback, and successful empty searches still return an empty list. The change preserves the existing clinic filters.

## Verification

- TypeScript using `tsconfig.lint.json` passed.
- The full Bun unit suite passed with 1,321 tests across 117 files. The new cases distinguish failed Encounter and Patient searches from a successful empty list.
- The browser evidence is from Task 734. Task 735 used the requested server-free checks and did not rerun Playwright or the full `check-all.sh` gate.

See [the research notes](research/task-735.md) for sources.
