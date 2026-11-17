#!/usr/bin/env bash
# Full gate after every task: lint+types, build, Playwright (1 worker), 4-clinic check.
# Usage: e2e/scripts/check-all.sh <label> [baseline-results.json]
# Exits non-zero if any step fails or any test fails that passed in the baseline.
# Strict targets (UCC_GATE_TARGET=staging, set by e2e/scripts/check-staging.sh): the baseline must exist and be
# attested for that target (e2e/scripts/lib/baseline.mjs); a missing/foreign baseline FAILS the gate (Task 533).
set -u
LOG_ROOT=${UCC_LOG_ROOT:-/workspace/ai-logs}
LABEL=${1:-run}; BASE=${2:-$LOG_ROOT/baseline/results.json}
REPO=$(cd "$(dirname "$0")/../.." && pwd); OUT=$LOG_ROOT/$LABEL; mkdir -p "$OUT"; FAIL=0
export UCC_MEMBERSHIP_BACKUP_DIR=${UCC_MEMBERSHIP_BACKUP_DIR:-$OUT/membership-backups}
export UCC_EVIDENCE=${UCC_EVIDENCE:-$OUT/evidence}
export UCC_SAVE_SHOTS=${UCC_SAVE_SHOTS:-$OUT/save-state-shots}
export UCC_REPORTS=${UCC_REPORTS:-$LOG_ROOT/e2e-reports}
export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=1536}
if [ -n "${UCC_GATE_TARGET:-}" ] && [ "$UCC_GATE_TARGET" != local ]; then
  node "$REPO/e2e/scripts/lib/baseline.mjs" check "$BASE" "$UCC_GATE_TARGET" || { echo "OVERALL: FAIL (baseline not trusted for $UCC_GATE_TARGET)"; exit 1; }
fi
step() { local n=$1; shift; "$@" > "$OUT/$n.log" 2>&1; local c=$?; echo "$n: $c" | tee -a "$OUT/summary.txt"; [ $c -eq 0 ] || FAIL=1; }
: > "$OUT/summary.txt"; cd "$REPO"
step lint bun run lint
# Node 22 for build: undici needs markAsUncloneable (Node >=22.10); box default is Node 20
step build env PATH="$HOME/.local/node22/bin:$PATH" bun run build:ci
# Optional foreground orchestration: after this build, the caller starts the
# local built app in its own process group and creates this readiness file.
if [ "${UCC_E2E_BATCHED:-0}" != "1" ] && [ -z "${UCC_LOW_MEMORY_GATE:-}" ] && [ -n "${UCC_SERVER_READY_FILE:-}" ]; then
  [ "$FAIL" -eq 0 ] || { echo "OVERALL: FAIL" | tee -a "$OUT/summary.txt"; exit 1; }
  step server-ready timeout 3m bash -c 'while [ ! -f "$UCC_SERVER_READY_FILE" ]; do sleep 1; done'
fi
cd "$REPO/e2e"
RES=${UCC_REPORTS:-$LOG_ROOT/e2e-reports}/results.json; rm -f "$RES"
# Dev data hygiene: /api/queue caps at 200 encounters/day; leftover fake fixtures would hide the workflow test patient.
UCC_EVIDENCE=$UCC_EVIDENCE timeout 10m npx tsx scripts/prune-fake-queue.ts > "$OUT/prune.log" 2>&1 || echo "prune-fake-queue failed (see prune.log)" | tee -a "$OUT/summary.txt"
if [ "${UCC_E2E_BATCHED:-0}" = "1" ]; then
  timeout --kill-after=30s "${UCC_E2E_TIMEOUT:-40m}" node scripts/run-batched.mjs > "$OUT/e2e.log" 2>&1
elif [ "${UCC_LOW_MEMORY_GATE:-0}" = 1 ]; then
  # Driver owns one dev server at a time and reclaims its compiler heap between groups.
  timeout --kill-after=30s 40m node scripts/run-low-memory.mjs > "$OUT/e2e.log" 2>&1
else
  timeout 20m node scripts/warmup.mjs > "$OUT/warmup.log" 2>&1
  timeout "${UCC_E2E_TIMEOUT:-20m}" npx playwright test --workers=1 > "$OUT/e2e.log" 2>&1
fi
echo "e2e-exit: $? (baseline has expected failures)" | tee -a "$OUT/summary.txt"
cp "$RES" "$OUT/results.json" 2>/dev/null || { echo "no results.json" | tee -a "$OUT/summary.txt"; FAIL=1; }
node scripts/compare.mjs "$OUT/results.json" "$BASE" | tee -a "$OUT/summary.txt"; [ "${PIPESTATUS[0]}" -eq 0 ] || FAIL=1
step clinics npx tsx scripts/clinic-check.ts
echo "OVERALL: $([ $FAIL -eq 0 ] && echo PASS || echo FAIL)" | tee -a "$OUT/summary.txt"; exit $FAIL
