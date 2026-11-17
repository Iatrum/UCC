#!/usr/bin/env bash
# Staging gate adapter (Task 533 / plan 385c). Wraps check-all.sh with:
#  1. the staging safe-target preflight (positive allowlist, fails closed),
#  2. a REQUIRED baseline attested for target "staging" (compare.mjs fails otherwise).
# Starts no server and no container; the caller owns the staging stack (infra/staging/up.sh).
# Usage: e2e/scripts/check-staging.sh <label> <staging-baseline-results.json>
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LABEL=${1:?label required}; BASE=${2:?staging baseline results.json required (no default: a missing baseline must not pass)}
cd "$REPO"
bun run scripts/staging/preflight.ts || { echo "OVERALL: FAIL (staging preflight)"; exit 1; }
node e2e/scripts/lib/baseline.mjs check "$BASE" staging || { echo "OVERALL: FAIL (baseline not attested for staging)"; exit 1; }
export UCC_GATE_TARGET=staging
exec bash e2e/scripts/check-all.sh "$LABEL" "$BASE"
