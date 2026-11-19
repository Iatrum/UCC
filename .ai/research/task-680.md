# Task 680 — Twilio delivery callback clinic containment

## Verified from code (pre-change)
`POST /api/follow-up/twilio/status` is signature-authenticated (Task 541/619) but Twilio carries no clinic, so
`updateTwilioDeliveryStatus` matched by `MessageSid` over the 200 most recent follow-up Communications of ALL
clinics and accepted any non-empty `clinic` tag. Real gaps: (1) no binding to the sending clinic — a SID present on
another clinic's record (or a record carrying mixed tags) would be written; (2) the cross-clinic 200-record window
could also miss the right record. Untagged records were already excluded (Task 619).

## Fix
- `buildTwilioStatusCallbackUrl(base, clinicId)` adds `?clinic=<id>` to the `StatusCallback` at send time
  (`sendFollowUpWithTwilio` already asserts the stored record belongs to the caller's clinic).
- Twilio signs the full URL incl. query (https://www.twilio.com/docs/usage/webhooks/webhooks-security), so the clinic is
  tamper-proof: the route verifies the signature over `TWILIO_STATUS_CALLBACK_URL` + the request's `clinic` param.
  No clinic param or a swapped one => 403, zero Medplum access.
- `updateTwilioDeliveryStatus(..., clinicId)`: searches with `identifier=clinic|<id>` and requires every `clinic` tag
  to equal the sending clinic; foreign/untagged/mixed => null, zero writes. No clinic => null.
- Nothing sensitive logged (no new logging).

## Deployment note
`TWILIO_STATUS_CALLBACK_URL` stays the bare URL (no query). Messages sent before this deploy have a callback URL
without `clinic` and will get 403 (their delivery status is no longer updated; already-sent messages only).

## Tests
`tests/unit/task680-twilio-callback-containment.test.ts` (own OK, foreign/untagged/mixed blocked, no/swapped clinic 403;
removing the tag guard fails 3 tests). `tests/unit/twilio-status-signature.test.ts` updated to sign the clinic URL. tsc clean.
