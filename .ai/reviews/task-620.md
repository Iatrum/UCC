# Review Task 620 — Task 619 (PR #318, Twilio callback signature)

Verdict: **APPROVE**

Checked against Twilio webhook-security docs (https://www.twilio.com/docs/usage/webhooks/webhooks-security):
- Algorithm: HMAC-SHA1(authToken, fullURL + sorted(key+value)) base64 — matches doc test vector (test included, passes).
- URL: signed over `TWILIO_STATUS_CALLBACK_URL` (exact URL given to Twilio as `StatusCallback`), not the proxied request URL, so Vercel's rewritten host/proto cannot break it. Added a test proving this (proxied request URL ok; signing the proxied URL => 403).
- Params: all form fields from `formData()` used (Twilio may add fields); non-form content-type => 403.
- Compare: `timingSafeEqual` after length check (length leak is harmless: fixed 28-char base64).
- Fail closed: unset token / URL / signature => false => 403 before any Medplum access (tests assert zero search/update).
- Send path unchanged: `StatusCallback` still set from the same env var, so follow-up sending works; unit tests (39) pass incl. task400 containment.
- SID lookup narrowing: `category=<system>|` token search + clinic-identifier + category re-check; unknown/untagged => no write.

Non-blocking notes:
- Lookup scans the 200 most recent follow-up Communications; very late callbacks for older messages are ignored (acceptable; was 20 before).
- Duplicate form keys collapse to the last value (Twilio status callbacks don't send duplicates).
- Deployment must set `TWILIO_STATUS_CALLBACK_URL` to the exact public URL (incl. any query string) or all callbacks 403.
