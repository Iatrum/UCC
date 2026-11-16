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

**Verdict: CONDITIONAL APPROVE after fix loop 1; full integration acceptance remains blocked by the gate environment.** No remaining MAJOR findings identified in the reviewed viewer/clinic paths. This is a code-review verdict, not certification of the required full regression gate.

- Final unit run: 82 pass, 0 fail. Final lint/type check: exit 0. `git diff --check`: clean.
- Focused Playwright (single worker, explicit timeout, own :3341 server, dev Medplum http://127.0.0.1:8113 only): initial 8 pass / 1 fail. The existing foreign-patient API test failed in fixture UI setup because the X-ray region did not appear, before its API assertions. Targeted rerun: 2/2 pass, including that test and the strengthened study/report/URL regression. All nine distinct focused cases have a passing execution; the first suite was not an uninterrupted green run.
- The strengthened regression also checks an unrelated same-clinic report cannot attach to a different study. Report matching is verified explicitly rather than trusting a nonstandard `study` search parameter alone.
- Standalone clinic inventory: exit 0, 0 invalid accounts (105 missing accounts inventoried under the existing non-strict mode). Only the script's local-origin guard was temporarily adapted from localhost to 127.0.0.1; the temporary file was removed. This is not strict account-completeness certification.
- Required `e2e/scripts/check-all.sh task341-review`: attempted, OVERALL FAIL because it hard-codes /workspace/ai-logs, and /workspace cannot be created by this VPS user. Redirections failed before checks ran; no baseline file exists at its default path. No claim of “no new failures” is possible. Several broader-suite tests also hard-code :3210, owned by another dev server, so that suite needs a portable harness before a safe full run here.
- Separate local `bun run build:ci`: exit 0 (heap capped at 1536 MB; own dev server stopped first). GitHub lint-and-build succeeded for fix commit c0f7eae.

Evidence logs are outside the repository: /home/dev/task341-{final-unit,final-lint,e2e,rerun,clinics,gate,build}.log. Original Task 340 screenshot artifacts were inspected; incidental regenerated screenshots were restored rather than committed.

Review worktree: /home/dev/ucc-task341, created from origin/dev then fast-forwarded to the PR head. Worktree-local author identity copied from the last dev commit. Fix milestone c0f7eae pushed normally to ai/task-340-xray-phase2, as explicitly authorized. No merge, force-push, new PR, sidebar/nav change, production container operation, /opt/medplum, /root, Supabase or Tradebot access. Own server process group 738824 was terminated and :3341 is closed. Ignored secrets/environment files were not staged.

GitHub REST snapshot before final documentation push: mergeable=true, mergeable_state=clean, draft=true at c0f7eae. Recheck after the documentation push; draft status is preserved.
