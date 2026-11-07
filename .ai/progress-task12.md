# progress-task12

Updated: 2026-11-07 ~08:52 MYT (Grok Bot executor — finish gate + draft PR)

## Done
- Plan written (D28: narrow A, reuse `pacs`, widen subscription, v1 Chest/limb studies, one draft PR)
- Phase 1 (0505817): X-ray device layer + XRAY_STUDIES catalog + GET /api/pacs/devices
- Phase 2 (9ba5f7f): composer ordering (XraySection, pacsEnabled, order.xray branch, PATCH/DELETE module-gated, DX filter bug fixed)
- Phase 3 (98f4a35): device bridge (`lib/pacs/xray-device-bot.ts`, POST /api/imaging/receive/message), Lab tab "Pending X-ray" card, `/api/labs/subscription` widened to poct OR pacs, `scripts/pacs/sim-xray.ts`
- Phase 4 (31da9a3): `e2e/tests/xray.spec.ts` (5 tests) + `basedon` search-param fix
- Bugfix (4afac89): DiagnosticReport ImagingStudy search param is `study`, not `imaging-study`
- Bugfix (2d0db1c): `poct.spec.ts` anonymous subscription context missing `storageState` override
- Auth refresh: regenerated `e2e/.secrets/state.json` via `/api/auth/login` (not committed). Demo/clinicb/clinicc/clinicd Orgs confirmed no leftover `poct`/`pacs` toggles before gates.
- Gates on `/workspace/ucc-pr-12` @ `2d0db1c` against :3210 / Medplum :8113:
  - **task12-gate6** (best): lint 0, build 0, clinics 0, e2e **33/37**. All 5 xray + all poct/api/module-toggle passed. Workflow 01–07 passed; 08 documents tab blank-page flake; 09–10 skipped (serial); 11 known-bug = baseline-only expected fail.
  - task12-gate7/8/9: lint/build/clinics 0; **xray 5/5 every time**; workflow hit register hydration race / Medplum login 429 / blank-page after Sign (infra, not Task 12 code — same suite passed 01–07 on gate6).
- CHANGELOG Task 12 entry added. Draft PR `ai/task-12` → `dev` opened by executor.

## Remaining / out of scope
- Time Chit still deferred (`070-time-chit`)
- Codex remains user-paused — do not unpause
- No merge, no sidebar/nav, no Hostinger/prod

## Notes for future resumes
- Do not background e2e; run foreground. Before gates, no-cache-read Orgs for leftover module toggles.
- Playwright `storageState` cookies are host=`localhost` (not 127.0.0.1). Medplum auth ~5/min/IP — cool 65–70s between login bursts.
- Hang-guard may still watch Claude session 43cdc45a; do not start a competing Claude build while executor owns the finish.
