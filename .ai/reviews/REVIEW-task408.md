# Review — Task 408 (PR #269, MC + referral documents)

Reviewer: Task 409. Verdict: **APPROVE** (non-blocking notes below).

## Checks run (worktree, base origin/dev)
- `bun test tests/unit`: 244 pass, 0 fail
- `tsc --noEmit`: clean
- `eslint` on touched files: 3 errors / 2 warnings, all in `order-composer.tsx`, identical on origin/dev (pre-existing `react-hooks/immutability` / exhaustive-deps) — no new lint issues.
- Not run: Playwright e2e / live print (static + unit review only).

## Findings
- **Clinic containment: OK.** No new reads/writes. Document Procedures still go through `withClinicIdentifiers` + `meta.accounts`; the new Provenance carries the clinic account. Referral meds/allergies come from the already clinic-scoped `patient` prop (`medicalHistory`), no new fetch.
- **Composer: OK.** Changes are additive (new state, fields, print buttons); save path only adds meta keys. Not exercised in a browser. Cosmetic: the "Insert smart fields" hint box was removed.
- **No sidebar/nav changes.** None in diff.
- **PDPA: OK.** Tests use fake data only (Ali Fake, Dr Fake). No secrets.
- **Print output: OK.** Values HTML-escaped; `referralBody`/`mmcLine`/`diagnosisBlock` are raw but built from escaped content. MC diagnosis hidden by default, legacy templates stripped. Empty MMC prints nothing.
- **Tests: meaningful for pure helpers** (hide/show, escaping, MMC, referral body, note detection). Gap: no test for `auditSignedDocument` / service wiring.

## Non-blocking notes
1. `fillDocumentTemplate` replaces sequentially, so a user value containing `{{key}}` can be expanded by a later key. Low impact (self-authored values); a single-pass replace would fix it.
2. Signer name/MMC is remembered in browser `localStorage` and prefilled; on a shared workstation another doctor could print under the previous doctor's MMC. Consider clearing on logout or showing it clearly as editable.
3. Add a service-level test for the Provenance wiring.
4. The legacy-template diagnosis strip regex only matches a simple `<tag>Diagnosis: {{diagnosis}}</tag>` shape.
