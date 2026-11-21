# Task 775 — C4 leftovers (imaging billing, dev clinic audit)

Branch: `ai/task-775` (local) pushed to `ai/task-738-imaging-billing` (PR #352), after merging `origin/dev`. Doc-only conflicts (CHANGELOG, DECISIONS) resolved by keeping both sides. Other open PRs (#350-#362) were not touched; none carries an imaging-billing or clinic-audit fix.

## Method
Dev Medplum 5.2.x at `127.0.0.1:8113`, fake data, one `next dev --webpack` server on `:3275` (3072 MB heap), killed afterwards. References: [FHIR R4 Procedure](https://hl7.org/fhir/R4/procedure.html) (`status` preparation vs completed; `identifier` for business ids), [Medplum search/identifier docs](https://www.medplum.com/docs/search).

## Results
| Item | Result |
|---|---|
| (a) Imaging billing | Not reproducible. `workflow.spec.ts` 11/11 (incl. Sign replay -> one `preparation` Procedure, one charge, checkout pays). `xray.spec.ts` 8/8. Fix is in PR #352 (`signEntryId` identifier de-duplicates replays). |
| (b) Dev clinic audit | `e2e/scripts/clinic-check.ts` exit 0, `problems: []`, accounts `invalid: 0` (837 legacy `missing` are inventory only in phase-1 mode). The earlier invalid record (Task 706/722) no longer exists: stale fake data. No script/app change. |
| tsc, eslint (changed files), `bun test tests/unit` | clean; 1320 pass, 0 fail |

Not run: full `check-all.sh` (build + whole suite); C4 stays open for it and for production Medplum version parity.
