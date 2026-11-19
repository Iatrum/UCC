# Review of Task 694 (PR #334, commit 0152a7f) — Task 695

Independent re-run on a fresh production build (`bun run build:ci`, Node 22) of 0152a7f, `next start` on `:3695`, dev Medplum `127.0.0.1:8113` only, fake data, 1 worker, heap 3072 MB, server process group killed after each run. Raw logs kept privately in `/home/dev/ucc-695-evidence` (not committed).

## Counts re-run (the specs Task 694 changed)

| Specs | Result | Matches Task 694? |
|---|---|---|
| poct, xray, xray-phase2, time-chit | 19 passed (incl. all 14 formerly failing device specs) | yes |
| xray-phase3 | 1 skipped (needs `PACS_DEV_STATE_DIR`, not provisioned) | yes |
| workflow (01-11) | 10 passed, 1 failed: `11 known-bug probes summary`, designed to fail, listing exactly one bug (generic imaging order writes a completed Procedure at Sign) | yes |
| staff-membership | 1 passed (4.1 min; no 429 retry needed this time) | yes |

Total for these specs: 30 passed, 1 designed failure, 1 skipped. Consistent with the reported 94 / 1 / 2 full-gate figures (full gate not re-run; `dispense-checkout-ui:81` skip not re-checked).

## Weakening check

- No assertion deleted. The only removed assertion is the stale `bug(r.ok(), ...)` probe, replaced by two hard `expect`s (status 400 and `results[0].status is required`): stricter, and the 400 is the deliberate route contract.
- `staff-membership`: retry is bounded (3), triggers only on `Admin login failed (429)`, and any other exit status still fails; failure message now includes the CLI's first line.
- `deviceMeta` opt-in tag: fixtures now exercise production behaviour instead of being hidden by it. Not weakened, but note the coverage gap below.
- `time-chit` `.first()` matches the existing pattern in the same spec. `RUN` stays all-digit (api.spec slices `-2`/`-4`).
- No new `skip`/`fixme`. Existing skips are explained (#279; PACS state dir).
- The Task 674 edits in the same PR (403→404, error text, accession encounter) replace assertions with the current contract; none are deleted.

## Notes (no change made)

- No spec asserts that `simulated`-tagged Devices are hidden in production builds (`lib/fhir/{poct,xray}-device.ts`). Previously this was only an accidental effect. A small dedicated spec could be added later; not a regression.
- `RUN` random tail has a 1/1000 chance of collision within the same second; acceptable.

## Verdict

Task 694 claims reproduce; no test weakened; no fixes needed. No app code or composer touched.
