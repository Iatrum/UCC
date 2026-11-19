# Task 655 - ESLint cleanup

Full ESLint on dev (805106a): **8 errors**, 11 warnings. After: **6 errors**, 11 warnings (warnings untouched).

Open PRs checked (gh pr list/diff --name-only): #324, #323, #322, #321, #320, #317 (75 distinct files).

## Fixed
- `components/labs/lab-results-view.tsx` (react-hooks/set-state-in-effect): state resets inside the effect replaced by a
  keyed wrapper (`key=patientId:encounterId`) that remounts the inner component; behaviour identical (fresh state per key).
  Ref: https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
- `app/(routes)/login/page.tsx` (set-state-in-effect): one targeted eslint-disable with a comment. The latch depends on a
  submit-time ref that cannot be read during render, and deriving it would change the sticky behaviour.

## Left (skipped)
- `components/orders/order-composer.tsx` - in open PR files (touched by one of the listed PRs) and is the consultation composer: 2x react-hooks/refs (L230, L421),
  2x react-hooks/immutability (L552 persistEntry, L655 removeEntry used before declaration).
- `lib/hooks/use-consultation-draft.ts` L99, L102 react-hooks/refs (`setSigning`/`retry` in returned object read refs). Not in any
  open PR, but it is the consultation composer's draft hook; skipped per "do not touch the composer". Likely fix: wrap both in useCallback.
