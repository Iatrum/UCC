# Task 6b – Medplum rate limit shown as "wrong password"

## Finding
- `app/api/auth/login/route.ts` `startEmailPasswordLogin`: ANY non-OK from Medplum `/auth/login` -> `LoginRouteError('AUTH_CREDENTIALS', …, 401)`.
  So 429 (rate limit) and 5xx (Medplum down) show "Incorrect email or password".
- Client `lib/auth-medplum.tsx` `classifyAuthError` has no rate-limit branch; it matches `invalid`/`401`/`auth_credentials`.

## Sources
- Medplum rate limits: `/auth/login` = 5 requests per IP per minute, answers `429 Too Many Requests`, `RateLimit` header `t=` seconds to reset: https://www.medplum.com/docs/rate-limits
- RFC 6585 §4 (429) + Retry-After: https://www.rfc-editor.org/rfc/rfc6585#section-4 , RFC 9110 §10.2.3: https://www.rfc-editor.org/rfc/rfc9110#field.retry-after
- OWASP Authentication cheat sheet (generic message only for bad credentials; lockout/throttle may be stated): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

## Plan
1. Server: Medplum 429 -> `AUTH_RATE_LIMITED`, HTTP 429, `Retry-After` seconds (from Medplum Retry-After or RateLimit `t=`, default 60, clamp 1..600). 5xx/network -> `AUTH_UNAVAILABLE` 503. 400/401/403 stays AUTH_CREDENTIALS 401 (no user enumeration). Same for the token exchange step if it can 429.
2. Client: `classifyAuthError` checks rate-limit first (`auth_rate_limited`/`429`/`too many`), passes through retry seconds; login page shows "Too many sign-in attempts. Please wait about N seconds and try again." AUTH_UNAVAILABLE -> server-unreachable message.
3. Don't log passwords/emails.

## Verified locally (11:47 MYT)
curl x8 to local Medplum /auth/login with a fake email: 1-5 -> 400 + `RateLimit: "requests";r=N;t=60`, 6+ -> 429 + same header. No `Retry-After` header. Bad credentials = 400 (not 401).

## Revised plan (after Claude critique REVISE)
- route.ts: `LoginRouteError` gets optional `retryAfterSeconds`; catch returns JSON `{code,error,retryAfterSeconds}` and HTTP `Retry-After` header when set.
- `startEmailPasswordLogin`: 429 -> AUTH_RATE_LIMITED/429, seconds from `Retry-After` else RateLimit `t=` else 60, clamp 1..600. status>=500 or fetch throw -> AUTH_UNAVAILABLE/503. Other non-OK -> AUTH_CREDENTIALS/401 (unchanged).
- `exchangeAuthorizationCode`: only add 429 -> AUTH_RATE_LIMITED (Medplum docs: /oauth2/* is rate-limited at 160/min); else unchanged.
- `signIn` (lib/auth-medplum.tsx): encode as `AUTH_RATE_LIMITED:<secs>: msg`; `classifyAuthError` keeps AUTH_RATE_LIMITED / AUTH_UNAVAILABLE codes (check before the credentials branch).
- login page catch: new branches: "Too many sign-in attempts. Please wait about N seconds and try again." and "The sign-in server is busy or unavailable. Please try again shortly."
