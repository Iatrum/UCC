# Task 749 review of Task 748

Reviewed draft PR [Iatrum/UCC #356](https://github.com/Iatrum/UCC/pull/356) at `92e1a2a` against `dev` at `737cbd8`. The original PR updated the changelog, decisions, and UX findings. Task 506 had already added visible loading text.

- **Accessibility.** The patient dialog previously inserted an already-populated status node when loading started. The initial dialog description now includes the loading message. The polite status persists for retry while the dialog is open and sits outside the `aria-busy` preview region. The preview clears its busy state on success or failure. The existing error alert, Retry action, and print restrictions remain in place.
- **Correctness.** Both patient document dialogs used shared async state. Closing during preparation and opening another document could show stale HTML under the second document’s title. Both paths now share a loader that checks the current request before updating HTML, errors, or busy state. Closing invalidates the request. The preview is HTML in an iframe, with PDF output available through browser printing.
- **Scope.** The only runtime change is in the patient Documents tab. Reviewed the composer, checkout, and Lab/POCT call sites. Results stay under Lab, and POCT requires an online analyser and offers no manual result entry. The composer’s X-ray control and submit guard still use the clinic’s PACS toggle. The patch adds no clinical resource reads or writes and changes no clinic scoping, navigation, storage, or integration files.
- **Credentials.** The tracked diff contains no environment or secrets files and no recognized key or credential patterns. The isolated Chromium check used synthetic fixtures and intercepted every browser request.

## Verification

- TypeScript project check, repository lint, changed-file ESLint, and `git diff --check` passed.
- 147 focused units passed across document rendering and scoping, signed document locking and audit, Time Chit and Referral, plan save state, clinic bounds, POCT display, X-ray gating, and PACS viewer authorization.
- Chromium verified initial loading semantics, a stale response after close and reopen, successful preview and printing availability, failure and retry, and both signed and legacy referral paths. Screen-reader speech was not measured.
- Playwright passed the Time Chit historical print check and the workflow checks for consultation signing, composer plan saving, Lab results, and MC/Referral generation and print.
- `e2e/scripts/check-all.sh task749-localhost` passed against the Task 733 comparison report. Lint, build, and clinic check passed. Playwright recorded 94 passes, two known failures, and two skips. The gate found zero new failures.
- GitHub reported the original draft as `MERGEABLE`.

[Research and official references](research/task749.md)
