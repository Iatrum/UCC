# PLAN Task 3b – composer must not drop items added before the draft loads
Builder: Codex (bug). Reviewer: Claude (read-only). File: components/orders/order-composer.tsx only.
1. Add `entriesRef` (always the latest entries; update it inside `publishPlan` synchronously) and `hydratedRef` (false until hydration finishes).
2. In the hydration effect, when the GET resolves (success or error): if `entriesRef.current` is non-empty (user already added items), do NOT call `publishPlan(initialEntries)`; instead publish `merge(serverEntries, entriesRef.current)` = server entries + local entries whose `id` is not in server list. If nothing local, keep today's behaviour exactly.
3. Keep `active` ignore flag. No other behaviour change; no UI text change; no new deps.
4. Accept: probe 05 keeps "1 × RM 0.50" when picking immediately; e2e 05 known-bug goes away; no other test regresses.

## Revised after Claude critique (binding)
- Use explicit `userTouchedRef` (set true in every user mutation: add, remove, field/qty/price update, document edits) and `removedIdsRef: Set<string>` (filled by remove). Keep `entriesRef` updated synchronously in `publishPlan`.
- When the hydration GET resolves (success or error) and `userTouchedRef.current` is true: publish `local ∪ (server entries whose id is not in local and not in removedIds)` – LOCAL WINS. If not touched: today's behaviour unchanged.
- Do NOT add a `hydratedRef` skip: a new draftId must still load its own draft. Reset `userTouchedRef`/`removedIdsRef` at the start of each hydration run only when the draftId changed (track `lastDraftIdRef`), not on Strict Mode re-run.
- Only components/orders/order-composer.tsx. No UI text change. No new deps.
