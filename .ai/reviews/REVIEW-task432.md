# Review — Task 432 (PR #275): billing row clickable + "Ready to bill" label

Reviewer: Task 433 (independent). Reviewed commit `c2a7b8b` against `e6c8278` (dev base). Diff: `components/billing/billing-table.tsx`, `.ai/CHANGELOG.md` only.

## Verdict: APPROVE (no blocking findings; no code changes needed)

## Checks
| Area | Result |
|---|---|
| Keyboard | Pass. Name link and "Open checkout" are real `<a href>` elements (native Tab/Enter). Name link has a visible `focus-visible` ring; row gets `focus-within` background. |
| No nested interactive elements | Pass. Verified by SSR render (`renderToStaticMarkup`, fake row): the two anchors are siblings in different cells; `Button asChild` renders a single `<a>`, no `<button>` inside `<a>`. The row itself is not a handler (no `onClick`), so no div-as-button. |
| Accessible name | Pass. Action link `aria-label="Open checkout for <name>"` starts with the visible text "Open checkout" (WCAG 2.5.3 label-in-name). |
| Whole-row click | Stretched-link pattern (`tr.relative` + `a::after absolute inset-0`; button `relative z-10` stays above). Author reported navigation works in a browser; I confirmed the markup/classes. |
| Stored status values | Pass. Only the text in `getStatusBadge` changed; `case 'meds_and_bills'` and the `QueueStatus` type are untouched. |
| Nav / composer | Pass. Diff touches no sidebar/nav, composer, lab/POCT or clinic-scoping code. |
| Table structure | Pass. New "Action" header, empty-state `colSpan` 3 -> 4. |
| Screenshots | Match the description (before: "Meds & Bills", no action column; after: "Ready to bill", "Open checkout" button). Copied to `.ai/reviews/task432-screenshots/` since they only lived in /tmp. Fake patient only. |

## Non-blocking notes
1. **Label inconsistency:** `components/queue-table.tsx:238` still shows "Meds & Bills" for the same status on the queue page. Product call whether to rename there too; left unchanged (out of the task's stated scope).
2. **Two tab stops per row** go to the same URL (name link + button). Acceptable, and the explicit button is the intended discoverability fix; an overlay link with `tabIndex={-1}` would be an option if tab fatigue is reported.
3. The name link text now looks like plain text until hover (text-primary renders dark); the button supplies the affordance.
4. Full `check-all.sh` was not run by the author (hardcoded `/workspace/ai-logs`); I did not run it either. `bun test` parity claim (238/16 same as dev) was not re-run by me.

## Not done by this review
No live Playwright run (RAM shared with production); verification was static plus SSR render.
