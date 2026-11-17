# Task 541 — Twilio status callback authentication

## Finding (origin/dev 5019bdc)
`POST /api/follow-up/twilio/status` had **no authentication**: anyone could post `MessageSid` + `MessageStatus`
(JSON or form) and rewrite delivery status/error on a Communication via the admin Medplum client.

## Fix
- `lib/server/twilio-signature.ts`: Twilio's documented scheme, base64(HMAC-SHA1(authToken, url + sorted key/value params)),
  constant-time compare. Fails closed on missing token, URL or signature.
  Cross-checked against official `twilio` `getExpectedTwilioSignature` with the docs test vector (identical output).
  The `twilio` npm package was NOT added as a dependency (heavy; algorithm is ~10 lines).
- Route: form-urlencoded only (JSON is unsigned -> 403); signature verified before any Medplum access; the signed URL is
  `TWILIO_STATUS_CALLBACK_URL` (the exact StatusCallback we send), not the proxied request URL. Unset token/URL => 403.
  `error` free-text body field removed; only `ErrorCode` is used.
- `updateTwilioDeliveryStatus`: allowlist of documented Twilio statuses (unknown => no write); terminal delivered/failed
  not overwritten by late callbacks; still matches only by `MessageSid` extension.

## Ops note
`TWILIO_AUTH_TOKEN` and `TWILIO_STATUS_CALLBACK_URL` must both be set and the callback URL must byte-match what Twilio calls
(scheme/host/path/query), otherwise real callbacks get 403.

## Known remaining (out of scope)
SID lookup scans only the 20 most recently updated Communications (pre-existing); not clinic-scoped because Twilio carries no clinic context.

Refs: https://www.twilio.com/docs/usage/webhooks/webhooks-security
