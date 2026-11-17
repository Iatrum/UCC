# Task 420: X-ray DICOM e2e (`xray-phase3.spec.ts`) skipped in Task 416's gate

## Why it skipped
The test enables itself only when `infra/pacs-dev/.env.local` (Orthanc credentials) and `infra/pacs-dev/secrets/device-key`
exist **relative to the checkout it runs from**. Both are git-ignored and written by `up.sh`, so they exist only in the
checkout that started the PACS (`/home/dev/ucc-task357/infra/pacs-dev`). A fresh worktree has neither, so `AUTH` was
undefined and the test skipped with the misleading "not set up on this machine". URLs/ports (Orthanc `127.0.0.1:8042`,
viewer `127.0.0.1:3320`) were correct and the containers were healthy; they were never the problem.

## Fix (test setup only)
- `PACS_DEV_STATE_DIR` env var: directory holding `.env.local` and `secrets/` (defaults to the repo's `infra/pacs-dev`).
- The skip message now names the missing directory and the variable to set.
- No application bug surfaced: with the override the test passes (1/1, ~59 s) with FAKE DICOM only
  (`gen-synthetic.sh`, fake accession/patient `FAKE-XRAY3-*`; per-run fake Device key, restored afterwards).

## Constraint: the dev server port
Orthanc's Lua hook posts to the nginx relay `172.31.57.1:3321`, which forwards to `UCC_UPSTREAM` (default `127.0.0.1:3210`);
the OHIF viewer's auth also goes through that upstream. The dev server under test must therefore be the relay's upstream.
To use another port, recreate **only** the `ohif` container (Orthanc and its DB are untouched), then restore it afterwards.
Do this only when no other lane is using the dev PACS.

## Exact command
Worktree needs `.env.local` (Medplum + `PACS_*` server env; e.g. copy from the checkout that ran `up.sh`, never print it),
`e2e/.secrets/pw`, and `node_modules` (a symlink needs `--webpack`; Turbopack rejects symlinked node_modules).
```
PACS=/home/dev/ucc-task357/infra/pacs-dev           # checkout that ran up.sh
(cd $PACS && UCC_UPSTREAM=127.0.0.1:3420 docker compose -p ucc-pacs-dev up -d --no-deps ohif)   # only if not using :3210
NODE_OPTIONS=--max-old-space-size=3072 setsid node_modules/.bin/next dev --webpack -p 3420 -H 127.0.0.1 &
cd e2e && UCC_EVIDENCE=/home/dev/ucc-evidence UCC_REPORTS=/home/dev/ucc-reports UCC_BASE_URL=http://127.0.0.1:3420 \
  PACS_DEV_STATE_DIR=$PACS NODE_OPTIONS=--max-old-space-size=1024 timeout 900 ../node_modules/.bin/playwright test tests/xray-phase3.spec.ts
# afterwards: kill the dev server process group, and: (cd $PACS && docker compose -p ucc-pacs-dev up -d --no-deps ohif)
```
`UCC_EVIDENCE`/`UCC_REPORTS` are needed because the defaults under `/workspace` are not writable on this VPS.
If the dev server is on :3210 no ohif recreate is needed.

## Not run
`check-all.sh`, full e2e suite, `next build` (scope: this one test). Composer, nav and the X-ray toggle untouched.
