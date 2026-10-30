#!/usr/bin/env bash
# Full gate after every task: lint+types, build, Playwright (1 worker), 4-clinic check.
# Usage: e2e/scripts/check-all.sh <label> [baseline-results.json]
# Exits non-zero if any step fails or any test fails that passed in the baseline.
set -u
LABEL=${1:-run}; BASE=${2:-/workspace/ai-logs/baseline/results.json}
REPO=$(cd "$(dirname "$0")/../.." && pwd); OUT=/workspace/ai-logs/$LABEL; mkdir -p "$OUT"; FAIL=0
export NODE_OPTIONS=--max-old-space-size=3072
step() { local n=$1; shift; "$@" > "$OUT/$n.log" 2>&1; local c=$?; echo "$n: $c" | tee -a "$OUT/summary.txt"; [ $c -eq 0 ] || FAIL=1; }
: > "$OUT/summary.txt"; cd "$REPO"
step lint bun run lint
# Node 22 for build: undici needs markAsUncloneable (Node >=22.10); box default is Node 20
step build env PATH="$HOME/.local/node22/bin:$PATH" bun run build:ci
cd "$REPO/e2e"; node scripts/warmup.mjs > "$OUT/warmup.log" 2>&1   # cold dev server -> non-hydrated forms
RES=${UCC_REPORTS:-/workspace/ai-logs/e2e-reports}/results.json; rm -f "$RES"
npx playwright test --workers=1 > "$OUT/e2e.log" 2>&1; echo "e2e-exit: $? (baseline has expected failures)" | tee -a "$OUT/summary.txt"
cp "$RES" "$OUT/results.json" 2>/dev/null || { echo "no results.json" | tee -a "$OUT/summary.txt"; FAIL=1; }
node scripts/compare.mjs "$OUT/results.json" "$BASE" | tee -a "$OUT/summary.txt"; [ "${PIPESTATUS[0]}" -eq 0 ] || FAIL=1
step clinics npx tsx scripts/clinic-check.ts
echo "OVERALL: $([ $FAIL -eq 0 ] && echo PASS || echo FAIL)" | tee -a "$OUT/summary.txt"; exit $FAIL
