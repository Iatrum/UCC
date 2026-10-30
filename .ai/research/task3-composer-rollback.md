# Task 3 research: composer rollback when plan API fails

## Facts (code, read 2026-10-31)
- `app/api/consultations/plan/route.ts`: `isPlanStoreUnavailable()` matches UNAUTHENTICATED / default credentials / NOT_FOUND / "service account" / "Firestore". It does NOT match the ADC error, so the route falls to `handleRouteError` -> HTTP 500 with the raw message.
- `components/orders/order-composer.tsx`: `persistEntry` treats only `persistenceAvailable:false` or a few message strings as "unavailable"; any other error -> `rollback()` (item disappears) + toast. Footer text is `savingIds` empty ? "All changes autosaved." – it says "autosaved" even after a failure or when persistence is disabled (local-only).
- `lib/firebase-admin.ts`: no service account on the box -> falls back to ADC -> no project id.

## External
- google-auth-library throws exactly `'Unable to detect a Project Id in the current environment. \n…'` (GoogleAuthExceptionMessages.NO_PROJECT_ID_FOUND). https://googleapis.dev/nodejs/google-auth-library/latest/interfaces/ADCResponse.html
- Project id comes from GCLOUD_PROJECT/GOOGLE_CLOUD_PROJECT, credentials file, gcloud, or GCE metadata. https://firebase.google.com/docs/admin/setup ; https://github.com/firebase/firebase-admin-node/issues/1466
- React 19: optimistic update + rollback is fine; issue is classification, not React. https://react.dev/reference/react/useOptimistic

## Fix plan (Codex backend + small UI text)
1. Server: treat "Unable to detect a Project Id" (and "Could not load the default credentials", already) as plan-store-unavailable -> 200 `{persistenceAvailable:false}` so the composer keeps items locally (same as the existing stub path the e2e test uses).
2. Client: add the same string to `isDraftPersistenceUnavailable`.
3. Footer text truthful: when `persistenceDisabled` show "Draft not saved to server – items stay on this screen until you Sign."; after a real failure show "Last change not saved." instead of "All changes autosaved."
Firebase stays (AGENTS rule). No new deps.
## Test
e2e `05 composer without Firebase (real autosave path)` currently logs BUG "rolls back every added item"; after fix the item must be kept -> known-bug list shrinks.
