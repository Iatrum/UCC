# Review Task 563 — PR #307 (MC/Time Chit unified templates, #295 folded in)

Reviewed head 8201a44 (merge of claude/time-chit-core-527 / Task 527 into the Task 549/550 branch).

- No Time Chit module toggle remains: `modules/time-chit` deleted, "time-chit" gone from `KNOWN_BRANCH_MODULE_IDS`, `timeChitEnabled` prop removed from patient page, workspace and composer, guard no longer calls `isModuleEnabledForClinic`. Stale stored "time-chit" ids are dropped by `normalizeEnabledModuleIds`. Time Chit is available in every clinic.
- MC, Time Chit and referral render through `renderDocumentHtml` (`lib/document-render.ts`) in composer, Documents tab, checkout and the settings preview. Each kind keeps its own editable default template; one renderer, one print CSS, MYT dates.
- Composer behaviour otherwise unchanged: only the gating was removed and the renderer swapped; Lab/POCT untouched; no critical warning added.
- `tsc --noEmit`: clean. `bun test tests/unit`: 699 pass, 0 fail.
- #307 MERGEABLE vs dev (no merge-tree conflicts). #295 CLOSED, comment "Folded into #307".
- Not run: e2e / dev server (out of scope for this task).

Verdict: approve, no fixes needed.
