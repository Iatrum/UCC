# Task 725 review of Task 724

Reviewed Task 724 commit `251f668` against `origin/dev` at `b22d32e`.

## Findings and fixes

- Checking or unchecking a clinic could move its row while the checkbox had focus. The list now puts saved assignments first and keeps the tab sequence stable during edits. The ordering refreshes after a successful save.
- The filter's empty state was plain text. The picker now has a persistent polite status region for the live selection count and search feedback. The fieldset has a stable accessible name, and each checkbox retains its clinic name and subdomain as its label.
- A long unbroken clinic name or subdomain could create horizontal scroll inside the list at 390px. Clinic labels now wrap within the available row width.

## Payload and permissions

The PATCH body still contains `firstName`, `lastName`, and the complete `organizationIds` array in selection insertion order. Filtering leaves the draft assignment set intact, including IDs absent from the clinic list. The admin layout, user detail loader, PATCH route, platform-admin guard, and Medplum service matched `origin/dev` byte for byte. The service still reconciles PractitionerRole assignments with membership access and clinic accounts.

## Verification

- Chromium reproduced the moving checkbox row and horizontal overflow before the fix. After the fix, Tab and Shift+Tab followed the visible row order, Space toggled the named checkbox in place, and Enter in the searchbox left the form open. Search matched a subdomain case-insensitively. The form and scrolling list fit at 390px with long fake clinic labels.
- Chromium's accessibility tree exposed the clinic assignment group, named searchbox, named checked checkbox, and polite status region.
- An actual PATCH against the fake dev practitioner sent the existing payload shape, including the saved assignment hidden by the filter. Both assignments persisted and appeared first after reload. The same route returned 401 for an anonymous request and 403 for the fake non-platform-admin account.
- All nine admin UI unit tests passed.
- The full Bun unit suite passed 1,229 of 1,230 tests. The scheduling test's error-message assertion also failed on `origin/dev`, where 1,226 of 1,227 tests passed.
- `e2e/scripts/check-all.sh task-725` passed lint, TypeScript, and the production build. Playwright reported 72 passes, 19 failures, and six skips. The historical comparison used the Task 722 gate report, which included separate browser fixture and test fixes absent from this base. The dev clinic audit also exited nonzero.
- The exact `origin/dev` build reproduced all 19 browser failures and all four dependent workflow skips in a targeted rerun of the six affected specs. The other two skips matched the historical baseline. The separate clinic audit reported one invalid clinic identifier and one invalid account on both builds. The full gate remained red with the same failures on the exact base.
- The browser and gate used only the dev Medplum at `127.0.0.1:8113` with fake fixtures. The local Next.js process groups were shut down and port 3725 was closed after verification.
