# progress-task12

Updated: 2026-11-06 08:12 MYT (daily build round)

## Done
- Plan written (`.ai/PLAN-task12.md`)
- Scope + build defaults decided as D28 (narrow A, reuse `pacs`, widen subscription, v1 Chest/limb studies, one draft PR)

## In progress
- Claude building via runner task `055-build-task12` (worktree `/workspace/ucc-pr-12`, branch `ai/task-12`)

## Remaining
- Catalog + Device (`xray-device.ts`, `XRAY_STUDIES`, sim fixture)
- Composer ordering (`XraySection`, `order.xray`, Sign path, PATCH/DELETE gated)
- Results path (pending card, receive/message bridge, duplicate guard, sim-xray, subscription widen)
- Fix `modality === "DX"` filter
- Full `check-all.sh task12` + draft PR into `dev`

## Notes
- Time Chit deferred to `070-time-chit` (after Task 12) — user priority is POCT X-ray first
- Codex remains user-paused; do not unpause
- Baseline ~29/30 (known-bug probes summary only)
