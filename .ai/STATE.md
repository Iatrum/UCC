# Task 358b — ready for review with validation limitations

2026-11-16. Worktree: /home/dev/ucc-task-358b. Branch ai/task-mc-referral-docs from origin/main. One draft PR: https://github.com/Iatrum/UCC/pull/253, base main, mergeable on last check. No merge or force push.

Implemented treatment-Sign issuance of printable MC/referral HTML DocumentReferences and existing patient-tab reprint. See .ai/REVIEW-task-358b.md and .ai/research/task-358b.md for design, sources and scope checks.

Final local validation:
- Production build: PASS (task358b-build-final.log).
- TypeScript: PASS, including the production build's type check.
- Unit suite: 28 PASS / 0 failures (task358b-unit.log).
- Dedicated API/browser lifecycle: 2 PASS / 0 failures (task358b-e2e-final.log), fake-data admin with explicit clinic scope.
- Existing Python static tests: 4 pass / 3 fail; same three patient-document failures as origin/main. No new failures.
- Logs are under /home/dev, outside the repository. The worktree's server on 127.0.0.1:3218 was terminated as a whole process group after testing; no listener remains.

Limitations: origin/main contains no e2e/scripts/check-all.sh, so the full required gate could not run. The dev fake doctor's migrated account policy blocks baseline main patient creation; ordinary staff integration requires the newer tenancy code, not policy weakening. The GitHub lint-and-build check passed for ba024ac; the credential workflow failed at browser installation (Playwright unsupported on ubuntu26.04-x64), before site/credential tests ran. Production services were not accessed to investigate.

No production containers, /opt/medplum, /root, other apps, real patient data, Firebase storage behavior, navigation, or Lab/POCT flows changed. Local credential files remain ignored and uncommitted.
