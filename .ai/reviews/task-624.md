# Review Task 624 — PR #315 (Task 587/623 Low UX leftovers)

Verdict: **APPROVE**

Checked (diff vs origin/dev, code + unit test + eslint on changed files; no dev server run):
- Checkout preview: derived-state refactor is correct. A result only counts if item/patient/issuedDate/organization match; effect deps match the inputs; rejected builds now settle to null (no stuck spinner). No loop risk (setState only inside async settle, guarded by `active`).
- Checkout grid `grid-cols-1`: layout only; xl/2xl columns unchanged.
- Billing table: mobile shows date/status under the name, desktop columns unchanged; action link unchanged.
- MC / Time Chit shared template editor: only a static hint line added; templates, placeholders and save/reset logic untouched.
- Inventory banner wording: verb agrees with attention count; unit tests cover cases.
- User edit form: label count + scroll cap only.
- Not touched: consultation composer, referral viewer, sidebar/nav, Lab/POCT. No new POCT feature.

Result: `bun test tests/unit/task587-banner.test.ts` 3 pass; eslint clean. No fixes needed.
