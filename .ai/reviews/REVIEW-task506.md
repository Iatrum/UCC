# Review: Task 506 (ai/task-506, draft PR #288) — by Task 507

**Verdict: APPROVE (with one trivial fix applied on the branch).**

## Checked
- Delete confirmation (AlertDialog) for signed docs and legacy referrals; names the patient, Cancel/Delete, state cleared before the handler runs. OK.
- aria-labels on delete buttons. Fixed: removed the redundant `sr-only` "Delete referral" span (aria-label already names the button, so it was read twice).
- Referral default text: no longer asserts "None recorded" / "No known drug allergies"; says "not documented". Ordered items are listed as "(ordered in this consult)". Unit tests updated and pass.
- Referral "to": empty default, label/`htmlFor`, `aria-required`, Complete button disabled + guard in `handleCompleteDocumentDialog`. The guard toast is unreachable via the button but harmless defence.
- Doctor identity warning: non-blocking amber status text when name/MMC is empty. OK.
- Documents tab wording ("Loading uploaded files…"), loading/status roles, MC row text ("date (N days) · diagnosis", "Issued … · Signed"), preview "Preparing preview...". OK.
- Composer: order-composer.tsx changes are confined to the referral dialog and the referral default memo (only read when the dialog opens, so the extra `entries` dep cannot overwrite user edits). No change to the order/plan flow, no lab/POCT or critical-result changes.
- No sidebar/nav files touched; no secrets in diff; test data is fake.

## Results
- `bun test tests/unit`: 567 pass, 0 fail.
- `tsc --noEmit`: clean.
- eslint on changed files: 4 errors (react-hooks refs/immutability in order-composer.tsx), identical set on origin/dev, so none are new.

## Notes (non-blocking)
- Previously saved referral drafts whose `referralTo` is the old "(Insert Hosp name)" placeholder pass the new non-empty check. Low risk.
- An ordered item that also appears in the patient's medication history is listed twice in the default text.
