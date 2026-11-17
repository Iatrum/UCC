# Review — Task 414 changes on PR #269 (commit a73c6f7, MC/referral)

Reviewer: Task 415. Fake data only. No dev server / Playwright started (static + unit review).

## Verdict: APPROVE (non-blocking notes). Not merged.

## Checks (worktree on PR head a73c6f7)
- `bun test tests/unit`: **280 pass / 0 fail** (includes 18 new adversarial tests added here).
- `bun run lint` (tsc + clinic-admin check): clean.
- `eslint` on touched files: 5 problems (3 errors, 2 warnings), **all in `components/orders/order-composer.tsx`, identical to `origin/dev`** (`react-hooks/refs`, `immutability` x2 for `persistEntry`/`removeEntry` self-referencing retry closures, `exhaustive-deps` x2). Task 414 did not touch the composer (`git diff a72421b..a73c6f7 --stat` has no composer file). Not fixed on purpose: it means restructuring autosave retry callbacks — too risky for "never break the composer"; suggest a separate e2e-covered task.
- `e2e/scripts/check-all.sh` not run (needs dev server; skipped to protect shared RAM).

## 1. Diagnosis hidden by default for every template shape — YES
- Layered: (a) default is hidden unless `mcIncludeDiagnosis` is `true`/`"true"`; (b) when hidden, `fillDocumentTemplate` never substitutes `diagnosis`/`diagnosisBlock` (defence in depth), so the value cannot print even if (c) the structural stripper (`lib/template-diagnosis.ts`, tokenizer + element tree) misses a shape.
- I added `tests/unit/mc-diagnosis-shapes.test.ts`: 17 hostile shapes (label in `<strong>`, `<span>` value, table row, `<li>`, heading + separate value paragraph, `<br>`-separated bare text, `{{ diagnosis }}` spacing, upper-case tags, multiline, attribute, unclosed tag, raw `{{diagnosisBlock}}`) plus default template hidden vs opt-in. All pass; none prints the value, surrounding content is kept.
- Checkout `McDocument` has no diagnosis prop, so it never printed it.

## 2. Are the audit tests meaningful? — YES
`tests/unit/signed-document-audit.test.ts` runs the real `createProvenance` with a faked admin writer: asserts target `Procedure/<id>`, agent + onBehalfOf, CREATE vs UPDATE coding, `recorded`, clinic account stamping, nothing written for time-chit / bad / missing notes or id, audit failure is non-blocking, and a **cross-clinic account is refused**. Mocks are restored in `afterAll` (bun mocks are process-global; full suite is green, so no leakage). Extraction into `signed-document-audit.ts` is behaviour-preserving.

## 3. Composer behaviour unchanged — YES
414 changes only lib helpers, one extracted service module and tests. Composer/patient-list code is exactly as in 408 (additive meta keys; old notes load as diagnosis-hidden). Lab/POCT, clinic containment (`withClinicIdentifiers`, `meta.accounts`), Firebase Storage and nav are untouched.

## Non-blocking findings
1. **Over-removal in short generic containers:** `<div>Fit to resume: Yes<br>Diagnosis: {{diagnosis}}</div>` (≤40 chars of other text, no other placeholder) is deleted whole, including the unrelated text. Fail-safe direction (hides more, never leaks) and unusual in templates, but worth tightening, e.g. only drop `<br>`-delimited segments.
2. Table row removal leaves an empty `<table></table>` when the diagnosis row was the only row.
3. From the 409 review, still open: sequential `{{key}}` replacement can expand a placeholder typed inside a user value (low impact); localStorage-remembered signer MMC on shared workstations; checkout print view (`McDocument`/`ReferralDocument`) ignores MMC / referral doctor name.
