# Review: Task 420 (PR #273, `ai/task-420-xray-dicom-e2e`, head a1c756b)

Verdict: **APPROVE (static review; live re-run NOT done)**

## Scope
2 files vs dev: `e2e/tests/xray-phase3.spec.ts` (+12/-3) and `.ai/research/task420.md`. Test setup only; no app, composer, nav or sidebar code.

## Live re-run: not done, and why
`free -h` available was 4.3 GB at the start, then 3.7 GB, below the 3.5 GB threshold once margin was counted. Another lane (`ucc-task5-policy-20261116`) owns the dev server on :3210 and was running Playwright against it. Its dev PACS `ohif` container had been recreated about a minute earlier. A second dev server plus a shared-PACS run would break the "one dev server" rule and could corrupt that lane's run. So this is a static review. The "1/1 passed in ~59 s" claim in the notes is unverified by me.

## Checks
- **Really runs, not skipped:** the skip was caused by `.env.local` and `secrets/device-key` being git-ignored and present only in the checkout that ran `up.sh`. `PACS_DEV_STATE_DIR` redirects to that checkout, which fixes the cause. Logic is correct (static). Not independently executed.
- **Skips cleanly without PACS (CI):** with no env var and no `infra/pacs-dev` state, `orthancAuth()` returns undefined and `test.skip(!AUTH, skipReason)` skips with a clear message naming the directory and variable. The `.github/workflows` files do not reference this spec or PACS. OK.
- **Credentials / real data:** diff contains no secrets. It only reads them at runtime from git-ignored paths (`.gitignore` covers `infra/pacs-dev/secrets/`, `.env*.local`, `e2e/.secrets/`). Data is fake (`FAKE-XRAY3-*`, synthetic pydicom). OK.
- **X-ray behind toggle:** app untouched. The test enables the `pacs` module only on a test clinic and restores the original extension in cleanup. OK.
- **Sidebar/nav:** no changes. OK.

## Minor notes (non-blocking)
1. If `.env.local` exists but lacks `ORTHANC_USER`/`ORTHANC_PASSWORD`, the skip reason stays the generic default.
2. The test skips on missing credentials only. With `PACS_DEV_STATE_DIR` set and the containers down it fails instead of skipping. Same as before.
3. The test overwrites the shared `secrets/device-key` in the PACS checkout and restores it afterwards. With `PACS_DEV_STATE_DIR` this file is now shared across worktrees, so a crashed run or two concurrent lanes can leave Orthanc with a stale or wrong key. Do not run it concurrently with another PACS lane.
4. The documented `ohif` recreate for a non-3210 port affects the shared PACS. Prefer :3210 when free.
