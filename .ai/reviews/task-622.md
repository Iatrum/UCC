# Task 622 — Review of Task 621 (react-hooks lint fixes in order-composer.tsx)

Commit reviewed: c707dbc. Verdict: **APPROVE** (no code fixes needed).

| Change | Behaviour impact |
|---|---|
| `failedSavesRef.current = failedSaves` + `eslint-disable react-hooks/refs` | None. Render-time ref sync is unchanged, so in-flight saves see the same timing. Moving it to an effect would have been the risky option, and it was not done. |
| `hydrationContext.current = {...}` + disable | None. Same reasoning. The hydration effect still doesn't restart on parent renders, so no refetch loop. |
| `persistEntry` / `removeEntry` self-reference in `setFailedSaves` + `react-hooks/immutability` disable | None. Comment-only. Retry replays the version captured at failure time, exactly as before. The stale `entries` closure in `removeEntry` is pre-existing, not introduced here. |
| `disablePersistence` added to `persistEntry` and `removeEntry` deps | Safe. `disablePersistence` is `useCallback(..., [])` (line 208), so it is stable and the callbacks are not re-created. No new refetch/render loop. |

Out of scope and untouched: catalog loading/retry/search, Lab/POCT rules (the commit changes only comments and two dep arrays). No composer feature is affected.

Verification: `eslint components/orders/order-composer.tsx` is clean. I did not run e2e or a dev server, because the diff is behaviour-neutral.
