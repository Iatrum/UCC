# BACKLOG

## Tonight (round 1), in order
1. [x] AGENTS.md, CLAUDE.md, .ai/, e2e suite in repo (`e2e/`, no secrets)
2. [x] Realistic dummy-data seed for 4 clinics (fake patients, encounters, orders, results)
3. [x] Composer bug: items roll back when `/api/consultations/plan` fails ("Unable to detect a Project Id") but UI still says "autosaved"
4. [x] Lock `/api/labs/receive` when `POCT_API_KEY` unset; fix 500 on lab result with no status

3b. [x] Composer hydration race (item lost if added before draft loaded)

## Later
- POCT phase 2 prerequisite: per-clinic device keys (FHIR Device per analyser) + check the ServiceRequest clinic matches the device's clinic before writing results (shared key today can write into any clinic)
- Access policy ProjectMembership leak (work in `/workspace/iatrum-ucc-ap`)
- `/admin` redirect loop; rate limit shown as "wrong password"; stock 500
- Network lockdown plan; staging plan
- UX audit
- POCT labs phases 1-3
- POCT X-ray
- Dispensing; MC/referral docs
