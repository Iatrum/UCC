# Review: Task 496 (UX audit part 2, PR #287)

**Verdict: APPROVE after the fixes below (committed on this branch).** Docs-only PR; no app code changed.

## Spot-checked against code (all real)
1. #1 `stockNegative` returned at `app/api/billing/route.ts:125`, never read by checkout-client (only invoiceId/invoiceNumber, `:577-579`); toast text at `orders-client.tsx:31-34`. Correct.
2. #2 unresolved/dispenseError only create billing-exception Tasks while returning `success: true` (`route.ts:95-122`). Correct.
3. #3 `handleDeleteSignedDocument` deletes with no confirm (`referral-mc-section.tsx:312-330`); legacy referral trash button (`:599-610`) has no sr-only label. Correct.
4. #4 / #9 / #12 / #16: `lib/clinical-documents.ts:80-81`, `order-composer.tsx:439,1002`, `admin/settings/page.tsx:20-23`, `lib/purchasing.ts:1` all match.
5. #7 e-Invoice button (`checkout-client.tsx:895-902`) and #5 dialog text (`:925-927`) match.

## Fixes made
- **Privacy:** screenshot 34 showed a real personal email pre-filled in the form. Removed the image; finding #13 now describes the hardcoded default (`create-medplum-client/page.tsx:21`, plus two scripts). NOTE: the image remains in earlier commit history of this branch (no force-push); squash-merge or rewrite before it reaches `dev` if that matters.
- #1: full path for checkout-client; line range corrected.
- #5: "void exists" clarified as API-only (no UI), so rewording "irreversible" needs owner confirmation.
- #3: clarified which `:572` label is referenced; header line no longer claims screenshots had "no secrets" unconditionally.

## Scope checks
- No separate dispense step suggested (#6 is display-only, explicitly stated).
- No new POCT feature, no sidebar/nav change proposed.
- Other screenshots reviewed (02, 31, 33, 35, 36): fake names, `@ucc.local`/`example.*` only. 33 shows a production console URL (finding #12), a hostname, not a secret. Remaining screenshots not individually opened beyond these.
- Not re-run live (no dev server per task); findings #1/#2 rely on code reading, as the doc states.
