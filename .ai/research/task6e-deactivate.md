# Task 6e — deactivate/reactivate a user

## Field used: `ProjectMembership.active`

`ProjectMembership.active?: boolean` — [fhirtypes/ProjectMembership.d.ts](../../../node_modules/@medplum/fhirtypes/dist/ProjectMembership.d.ts):114
("Whether this project membership record is in active use."). This is **not** `Practitioner.active`
(already used by `deletePractitionerFromMedplum` as an archive/soft-delete fallback — the Practitioner
resource itself stays "active" when we deactivate login access; only their membership/login is toggled).

Docs: [User Management Guide](https://www.medplum.com/docs/user-management) — "To deactivate a user's
access to a project without deleting their membership, you can update the `ProjectMembership` resource
and set the `active` property to `false`."

## Verified: Medplum enforces `ProjectMembership.active` server-side, independent of JWT expiry

Installed SDK (`@medplum/core` and fhirtypes) is **5.1.13**; server behavior below is verified against the deployed server **v5.2.8** tag, not SDK source or main.

All checks funnel through `getInactiveReason(project, membership)` in
`packages/server/src/fhir/projectmembership.ts`, which returns `'Profile not active' | 'Project not active' | undefined`.

Call sites found via `grep -rn getInactiveReason`:

1. **Login (password grant)** — `packages/server/src/oauth/token.ts:164` (client-credentials path) and the
   password/code-exchange path reads membership before issuing tokens.
2. **Refresh-token grant** — `packages/server/src/oauth/token.ts:344`: on `grant_type=refresh_token`,
   re-reads the `Login`'s membership and calls `getInactiveReason`; if inactive, responds
   `access_denied` and refuses to mint a new access token. **A deactivated user cannot refresh their
   session.**
3. **Every authenticated request (the important one)** — `packages/server/src/context.ts`
   `refreshAuthState()` (called from `runInAuthenticatedContext`, which wraps every authenticated
   FHIR/auth API call): it **re-reads the `Project` and `ProjectMembership` from the database on every
   single request** (`systemRepo.readResource('ProjectMembership', authState.membership.id)`), then:
   ```ts
   const inactiveReason =
     getInactiveReason(project, membership) ??
     (onBehalfOfMembership && getInactiveReason(onBehalfOfProject ?? project, onBehalfOfMembership));
   if (inactiveReason) {
     throw new RevokedAuthStateError(badRequest(inactiveReason));
   }
   ```
   `RevokedAuthStateError extends OperationOutcomeError`, outcome = `badRequest('Profile not active')`
   (issue `code: 'invalid'`, `details.text: 'Profile not active'` — confirmed from
   [`packages/core/src/outcomes.ts`](https://raw.githubusercontent.com/medplum/medplum/v5.2.8/packages/core/src/outcomes.ts)).

**Conclusion: an already-issued, unexpired access token stops working on the very next Medplum API call**
after `ProjectMembership.active` is set to `false`, because Medplum does not trust the JWT alone — it
re-validates membership state from Postgres per request. No client-side token revocation or extra
server-side session store is needed.

Sources:
- https://github.com/medplum/medplum/pull/10940 (`Project.active`, same `getInactiveReason` mechanism)
- https://github.com/medplum/medplum/pull/10962 ("Centralized background job membership active check" —
  confirms `refreshAuthState`/`RevokedAuthStateError` semantics for queued/background contexts too)
- https://www.medplum.com/docs/user-management

## Application auth-denial response mapping

Medplum's enforcement is sufficient on its own. The one rough edge: when a deactivated user's request
hits Medplum and gets `OperationOutcomeError` with `details.text: 'Profile not active'`, our
`handleRouteError` (`lib/server/route-helpers.ts`) had no branch for it, so it fell through to the
generic `500` handler — technically still blocks access, but the wrong status code and a confusing
"unexpected server error" for what is really an auth condition. Added an exact Profile/Project-not-active check mapping to `401`, alongside the SDK’s `isUnauthenticated` classification for standard Unauthorized outcomes. The live v5.2.8 server returned Unauthorized for a retained session after deactivation; both forms now produce 401 instead of 500.

## Self-protection

The server-side check is **not** "block if any admin targets another admin" — it's "block an admin from
deactivating their *own* membership", since that could lock every admin out with no way back in (there's
no "reactivate via Medplum root login" escape hatch guaranteed in this app). Implemented in
`app/api/admin/users/[id]/status/route.ts`: when `active === false`, compare `getCurrentProfile(req).id`
against the target practitioner id; reject with `403` if they match. The UI mirrors this by disabling the
button on `/admin/users/[id]` when the signed-in admin is viewing their own record (computed server-side
in `page.tsx` via `getCurrentProfile()`, passed down as `isSelf`).

## Session handling

No additional cookie/session invalidation was added in the Next.js app. Deactivating a user does not
need to touch `SESSION_COOKIE`/`REFRESH_COOKIE` because:
- Those cookies belong to the *browser* that is signed in as that user, not to anything the admin's
  session can reach.
- The next time that browser's session cookie is used for any Medplum API call (search, read, or even
  `GET /auth/me`), Medplum rejects it per the `context.ts` behaviour above.
- If the access token is expired and the browser tries to refresh, the refresh-token grant also rejects
  per `oauth/token.ts:344`.

So the deactivated user is locked out within one request round-trip, with no extra bookkeeping in our app.

## Fix loop 1

- Installed SDK declarations confirm `searchResourcePages` follows pagination and `patchResource` accepts JSON Patch. Lookup scans all pages and selects only memberships whose project reference matches the service identity from `auth/me`; missing membership is null/No login and mutation returns 409.
- New status route checks caller `auth/me.project.id` against service project id; global auth is unchanged.
- Status writes patch only `/active` (add if absent, replace otherwise), preserving unrelated membership fields.
- [Server v5.2.8 membership enforcement](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/projectmembership.ts)
- [Server v5.2.8 request context](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/context.ts#L272)
- [Server v5.2.8 token enforcement](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/token.ts#L340)
- [Server v5.2.8 auth/me](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/auth/me.ts)
- [FHIR R4 JSON Patch](https://hl7.org/fhir/R4/http.html#patch)
- [Next App Router promise searchParams](https://nextjs.org/docs/app/api-reference/file-conventions/page)
- [React 19 useState](https://react.dev/reference/react/useState)

## Executed verification (fix loop 1)

- `NODE_OPTIONS=--max-old-space-size=3072 bun run lint`: PASS.
- `NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit`: PASS.
- `bun test tests/unit/admin-memberships.test.ts`: 2 PASS (target after 500 memberships, foreign project ignored, missing login null; revoked-session OperationOutcome maps to 401).
- `cd e2e && UCC_ADMIN_E2E=1 npx playwright test tests/admin.spec.ts --workers=1 --reporter=line`: PASS, 1 test. `/workspace/ai-logs/admin-e2e/FINDINGS.md` marks deactivate/reactivate/self WORKS. Screenshots remain in its `shots/` directory.
- The first functional audit exposed Unauthorized being returned as 500 for retained-session access; fixed with SDK `isUnauthenticated`. An intermediate run hit the dev server's automatic memory restart. Another exposed screenshot caret-style injection during hydration; screenshots now use `caret: 'initial'`. Final requested run passed.
- Full gate `e2e/scripts/check-all.sh task6e-fix1`: lint and build passed; remaining results pending.
- No servers started/stopped, no commit, and no remote operations.
