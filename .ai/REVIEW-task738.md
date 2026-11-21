# Task 739 review of Task 738

Reviewed the Task 738 commit `1e6510e` on PR #352, based on `dev` at `737cbd8`. Task 704’s fix from PR #342 is in that base. [Task 738 PR](https://github.com/Iatrum/UCC/pull/352) · [Task 704 PR](https://github.com/Iatrum/UCC/pull/342) · [Task 739 research](research/task-739.md)

## Findings

- **Premature completion fixed.** Task 738’s archived fake-data workflow shows exactly one generic imaging Procedure in `preparation`, the imaging line at checkout, and a completed payment. Both consultation Procedure write paths use the pending status for generic imaging. Checkout uses the saved price and quantity regardless of Procedure status.
- **Duplicate charge on retry fixed in this review.** After a successful generic imaging Sign with a lost response, resubmitting the imaging charge could append a duplicate. The incoming key used a catalog ID, and the saved Procedure reloaded with only the name. New generic imaging lines use the draft entry ID persisted as a FHIR Procedure identifier. Distinct draft rows have distinct IDs. Older requests without an entry ID match the persisted imaging line fields. A billing-only replay with no added Procedures or prescriptions skips their replacement. Existing billing records are left as stored.
- **X-ray stays gated.** The device-backed section and API check the clinic’s PACS toggle, and the imaging order service requires an online clinic device. The device order reuses its ServiceRequest on retry, and the Encounter billing extension merges by draft entry ID. Generic catalog imaging retains its separate billing and ordering path.

## Verification

- The browser gate uses a local production build and fake records on loopback dev Medplum 5.2.15. The replay probe exercises the existing per-consultation lock in one app process. Production version parity remains a C4 release item.
- `tsc --noEmit --incremental false` passed. The full Bun unit suite passed all 1,318 tests.
- The generic imaging browser probe captured the actual Sign payload. Two concurrent billing replays preserved the original single `preparation` Procedure and its price and quantity. Checkout displayed the imaging charge and completed payment.
- The device-backed X-ray browser probe replayed the order and billing requests. It verified one active ServiceRequest for the online device, one matching checkout line and zero billing Procedures. The toggle-off probe verified the section was hidden, device discovery returned 404, and the order endpoint returned 403.
- `e2e/scripts/check-all.sh task-739` passed lint, production build, the browser comparison and the dev clinic data audit. Playwright recorded 97 passed and 2 skipped, with zero unexpected failures. The two baseline skips cover zero-value checkout and the stored-DICOM viewer workflow. The prior Feedback and Task 703 registration failures passed this run.

## Verdict

Approve Task 738 with the generic imaging retry fix. The imaging billing and X-ray toggle checks passed. Keep the C4 release hold for production version parity and the outstanding browser coverage.
