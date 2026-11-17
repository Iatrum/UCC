# Task 359 — review of Task 358 checkout stock deduction

Verdict: **CHANGES REQUIRED**. Review only; no application changes.

- PR: https://github.com/Iatrum/UCC/pull/268 (open draft, base `dev`).
- Reviewed head: `6bfb41c8568348e43216027a18860b6658cd26aa`.
- Reviewed base: `e6c82784c897df02408e1633381337721df36ce7`.
- Scope: the 13 changed files in the PR, billing/tenancy/auth callers, and installed Medplum SDK source. Findings below use line numbers at the reviewed head.

## Findings

### 1. P1 — Invoice writes and stock reconciliation can complete in different orders

`lib/fhir/billing-service.ts:379–394`; `lib/fhir/dispense-service.ts:280–284`.

Checkout saves the invoice, then reconciles stock from that request's `normalizedItems`. No invoice version/state is checked in the stock transaction. With an existing invoice and initial stock 100: request A saves quantity 5 and pauses; B saves quantity 2 and deducts 2; A resumes and reconciles to 5. Final invoice bills 2 while stock is 95. Both requests can report success. Medication If-Match protects concurrent stock writes but cannot detect that A's invoice input is obsolete. With multiple medications, interleavings can also produce a mix of two requests' demands. Checkout overlapping void/delete has the same missing invoice-state coordination.

Evidence: a synthetic service harness executed the stock phases in this allowed order and produced `persistedInvoiceQuantity=2, stock=95, expectedStock=98`. Invoice persistence was modeled explicitly; this was not an HTTP concurrency test.

Required correction: coordinate invoice revision/status and stock reconciliation for the entire visit, with a durable ordering/version check. Add deterministic changed-quantity and checkout-versus-void/delete tests; the existing concurrent e2e only uses identical quantities.

### 2. P1 — An unresolved billed line can undo a valid earlier deduction

`lib/fhir/dispense-service.ts:265–277`; `app/api/billing/route.ts:95–115`.

After deducting 5 units for a uniquely named item, adding another catalog item with the same name makes an identical checkout unmatched. The old medication is absent from `demand`, so the removal loop restores all 5 units and cancels its dispense although the billed line remains. Renaming a catalog item can cause the same result. The route drops `stock.unmatched`, and this path does not throw or create a stock exception Task, so the stock correction is silent to checkout operators.

Synthetic reproduction: stock `100 -> 95 -> 100`, dispense `completed -> cancelled`, with identical billed items; expected stock remains 95. The second call returns `unmatched=["Fake Drug"]`.

Required correction: distinguish a genuinely removed billed line from unresolved identity; retain the previous deduction until reconciliation is unambiguous and surface unresolved lines through the existing operational exception mechanism. Add ambiguity/rename-after-checkout regression coverage. A composer change is not required to expose or prevent this failure.

### 3. P2 — Single-page searches break completeness and idempotency

`lib/fhir/dispense-service.ts:115–119,255–258`.

`searchResources` returns one search page; `_count` is a requested page size. Neither the 500-item catalog nor 200-dispense lookup follows subsequent pages. Catalog items beyond the first page silently become unmatched; an earlier dispense beyond the first page is treated as absent, permitting another deduction and a duplicate audit record. Reversal and audit listing also omit later pages. A truncated catalog can make duplicate names appear unique.

Synthetic reproduction using the PR's fake with `_count` enforced: 201 distinct items, quantity 1 each, initial stock 100. Two identical runs leave the last item's stock at **98 instead of 99** and create **202 instead of 201** dispense records. The supplied fake ignores `_count`, hiding this boundary.

Required correction: paginate both searches, or use a complete exact-key lookup for reconciliation plus paginated enumeration for reverse/audit. Add page-boundary tests, including a clinic catalog larger than 500.

### 4. P2 — Successful restoration can precede a failed invoice void/delete

`lib/fhir/billing-service.ts:467–478`.

Restoration commits before the invoice is cancelled/deleted. If the final invoice operation fails, stock is restored and dispenses cancelled while the invoice remains balanced. A later medication failure during a multi-item reversal can likewise leave only some items restored. There is no durable reversal intent or compensation in this path; the API returns an error but leaves inconsistent persisted state until somebody retries. This is a code-path finding, not a live fault-injection result.

Required correction: make invoice state and restoration recoverable as one operation, and test final invoice-write failure plus failure after one medication has been reversed.

## Clinic scoping and negative stock

The HTTP checkout path validates the patient/encounter against the authenticated clinic before writing. Medication/dispense searches include the clinic identifier, stock reads are checked before writes, and new dispenses carry the clinic identifier and copy Medication account ownership. Audit reads use the staff client. No new cross-clinic access was demonstrated in this review. Existing focused containment tests pass; live two-clinic audit/void/delete and new dispense account-ownership tests are still needed. Deployment still requires the MedicationDispense AccessPolicy rule described in the PR; no policy was applied during review.

Negative stock is deliberately allowed by the Task 358 decision. The Items table explicitly shows Negative stock / Out of stock / Low stock badges, and the existing new unit test verifies a negative result. That behavior passes static review; negative stock itself is not a finding. Findings 1–3 concern incorrect or silently unreconciled quantities. Composer, Lab/POCT, Firebase Storage and navigation have no Task 358 edits.

## Verification and limits

- On the exact PR head in `/home/dev/ucc-dispense`: `NODE_OPTIONS=--max-old-space-size=3072 bun run lint` passed.
- `bun test tests/unit/dispense-service.test.ts`: **9 passed, 0 failed**.
- Combined dispense, inventory-validation and two write-containment unit suites: **44 passed, 0 failed**, 156 assertions.
- Scratch harness `/tmp/ucc-task359-repro.ts` used only synthetic in-memory resources and the PR unit fake; it confirmed findings 1–3 as described above. It is not a committed test or a live Medplum test.
- The PR reports four focused e2e passes plus lint/build; these are author evidence, not rerun results. The supplied e2e lacks deletion, changed concurrent inputs, two-clinic audit denial, pagination and injected transaction/invoice failures.
- Full `e2e/scripts/check-all.sh <label>` was **not run**: `/workspace/ai-logs/baseline/results.json` is unreadable in this environment and no Next server was listening on :3210. No server was started and no deployment or fixture/policy migration was performed. The repository's required no-new-failures gate remains **unverified**; this review does not certify it.
- No production containers, `/opt/medplum`, `/root`, real patient data, remote branches, merges or pushes were touched. The only authorized remote write is the PR review comment.

Research references and SDK checks: [research/task359-review-task358.md](research/task359-review-task358.md).

---

# Task 403 — review of Task 402 fixes (PR #268, head 46488f8)

**Verdict: APPROVE** (one non-blocking follow-up below).

## Verification
- Unit: `bun test tests/unit` → 261 pass, 0 fail. `tsc --noEmit` clean. `bun run lint` passes. (Run in a separate worktree at 46488f8; no dev server started, e2e not rerun.)
- Mutation check (revert each fix, run the dispense suites, then restore):
  | Finding | Mutation | Result |
  |---|---|---|
  | 1 invoice/stock ordering | invoice-version guard disabled | 5 tests fail (obsolete version, A/B race, differing quantities, void race, delete race) |
  | 2 unresolved line undoes deduction | retention branch disabled | 2 fail (duplicate name, rename) |
  | 3 single-page searches | `searchAll` stops after page 1 | 1 fail (>1 page catalog idempotency) |
  | 4 restore before invoice void | restore moved before cancel | 2 fail (failed void; failure after 2nd medication) |
  All four findings are fixed, each with a test that fails without the fix.
- Checkout never blocked by stock: `completeCheckoutInvoice` wraps the deduction in try/catch and returns `dispenseError` (route raises a `stock-deduction-failed` Task); negative stock is allowed and only flagged (existing negative-stock test passes).
- Idempotency: recorded-quantity delta, conditional create with claim token, If-Match claim; identical-concurrency, retry and stale-claim takeover tests pass.
- Clinic scoping: all dispense/medication searches carry the clinic identifier and `resourceMatchesClinicTenant`; `isClinicInventory` is checked before every stock write; reverse-other-clinic test passes. MedicationDispense access-policy rule still has to be applied at deploy (as in the PR notes).
- Scope: no sidebar/nav, composer, Lab/POCT or Firebase changes (checked the file list). Only UI change is stock badges in the Items table.

## Non-blocking follow-up (P3)
`lib/fhir/billing-service.ts` re-reads the invoice after saving and uses *that* version as the guard. If another checkout saves between this request's save and that read, the first request adopts the newer version as its own and may reconcile its obsolete quantities (window of a few ms; the second request's later claim still converges stock only if it runs after). Fix: compare the re-read version with the saved one (allowing only the tenant-assignment bump) and skip reconciliation otherwise. No test covers this window. Also noted by the author: concurrent first checkouts with no invoice may create two invoices; network timeout after a Medication PUT can double-apply on stale takeover.
