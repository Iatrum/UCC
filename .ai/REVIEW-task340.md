# Task 341 — independent security and UX review of Task 340

PR: https://github.com/Iatrum/UCC/pull/246 (draft, base dev).
Original head: 1eb0299c03c2838957e1561f6baa55237fcf16a0.
Reviewer: independent of implementation author; code and official references inspected directly (see research/task341-review.md).

## Findings and fixes (loop 1 of at most 2)

1. **MAJOR — incomplete clinic isolation.** The results route authorized the requested Patient/Encounter, but the subsequent ImagingStudy and DiagnosticReport searches lacked clinic identifiers. A foreign-clinic study referencing an authorized target, or foreign report referencing its study, could appear when the authenticated client has broad access. Both patient and encounter service functions now require clinicId and scope both resource searches. Report selection additionally verifies imagingStudy and subject references. Regression creates fake foreign resources attached to the caller's target and checks both query paths.
2. **MAJOR — untagged studies bypass link checks.** `if (!s.xray) return s` let untagged DX studies expose an off-list PACS viewer and arbitrary series URLs. Generic series endpoints reached window.open without protocol validation (including javascript:/data:). All returned URLs are now checked: viewer URLs require DX/CR/RG plus enabled PACS and the exact clinic host; X-ray series links require enabled PACS and allowlisting even without the tag; generic series retain credential-free absolute http(s) URLs only. Regression checks off-list untagged DX and hostile generic series.

## Security / product checks

- Exact host and port allowlisting, HTTPS, no credentials, no wildcard/subdomain matching; absent allowlist denies X-ray links. Unit coverage includes userinfo, lookalikes, invalid schemes, ports and backslash parsing.
- No server fetch, proxy or redirect of viewer URLs; no added iframe. Therefore no new SSRF or application open-redirect sink. Allowed external viewers can redirect or resolve via DNS; their behavior is a trust assumption, not a guarantee from DNS syntax checks.
- Text uses React escaping; viewer anchor has noopener/noreferrer/nofollow and no-referrer. Generic series navigation is now sanitized before reaching window.open.
- Admin host edits are guarded by requirePlatformAdmin and validated on PATCH. Config is read from the authenticated clinic's Organization. Platform-admin form authorization/save interaction still needs dedicated browser coverage.
- Composer, sidebar/navigation and Firebase code are untouched by this review. Lab results and viewer links remain in the Lab area, with no critical warning in the composer. Online-device guards and device-authenticated ingestion remain in place; no manual result-entry UI added.
- UX: inspected original after screenshot and Lab viewer flow. Clear View in PACS action; pending radiologist report is distinguished from available images. MINOR: an empty allowlist silently hides the action without explaining configuration to the clinician; series icon button lacks an accessible name. No navigation redesign made.

## Validation and verdict

In progress: unit suite and lint passed; focused browser validation and full-gate assessment pending. Do not treat this interim report as approval.
