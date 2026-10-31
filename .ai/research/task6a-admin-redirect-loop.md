# Task 6a – /admin redirect loop for non-admins

## Finding (code read 2026-10-31)
- `app/(admin)/admin/layout.tsx` -> `requirePlatformAdminPage(pathname)` (lib/server/medplum-auth.ts:306).
  Signed in but not admin -> `redirect('/login?error=admin_required&next=/admin')`.
- `app/(routes)/login/page.tsx` effect: when `isAuthenticated`, it only stops for `error=clinic_forbidden`.
  For `admin_required` it reads `next=/admin` and `router.replace('/admin')` -> layout redirects back -> loop.
- docs/AUTH.md:196/210 already says the intended end state is "/login?error=admin_required" (stay, not loop).

## Sources
- Next.js `redirect` in Server Components/layouts: https://nextjs.org/docs/app/api-reference/functions/redirect
- Next.js `useRouter().replace`: https://nextjs.org/docs/app/api-reference/functions/use-router
- OWASP Unvalidated Redirects (only follow `next` the user may open): https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html

## Plan
1. Login page effect: if `error=admin_required` and signed-in user is not admin -> do NOT auto-follow `next`; show a clear inline notice
   "Your account is not a platform admin" with a button "Go to my clinic dashboard" (/dashboard) and "Sign in as a different user" (/logout).
2. Generally: never auto-follow a `next` that starts with `/admin` for a non-admin (defensive, covers other entry paths); fall back to /dashboard.
3. handleSubmit path unchanged except same `/admin` guard for non-admins.
4. No server change (layout redirect is correct).

## Evidence (before)
- devserver.log shows /admin -> /login?error=admin_required&next=%2Fadmin -> /admin … repeating, ending in a 500 "Unexpected end of JSON input" overlay (screenshot /workspace/ai-logs/task6a/before-admin.png).

## Revised plan (after Codex critique REVISE)
- Add helper `isAdminPath(p)` = p === '/admin' || p.startsWith('/admin/') and `safeNext(p)` = starts with '/' but not '//' and not '/\\'.
- Effect: if signed-in non-admin and (error=admin_required OR next is an admin path) -> do NOT navigate; show inline notice card (role="alert"): "This account is not a platform admin" + button "Go to my clinic dashboard" (reuses the same clinic-aware navigation helper as the effect: clinic subdomain on prod, /dashboard locally) + "Sign in as a different user" (/logout).
- handleSubmit: guard the RETURNED redirectUrl with the returned isAdmin; non-admin + admin path -> go to clinic dashboard via the same helper (fresh login proceeds, it is not stuck on the notice). Use a ref so the effect does not double-navigate after submit.
- Admin users unchanged. clinic_forbidden unchanged.
