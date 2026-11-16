#!/usr/bin/env bash
# Re-send every study held by the dev Orthanc to UCC's PACS ingress (idempotent: known studies are
# only refreshed, unmatched ones stay in the review list). Use after UCC was down or a webhook failed.
# Runs from the HOST (not from inside Orthanc), so it can use ?wait=1 and print each outcome.
# Usage: ./resync.sh [ucc-base-url]     (default http://127.0.0.1:3210)
set -euo pipefail
cd "$(dirname "$0")"
ucc=${1:-http://127.0.0.1:3210}
set -a; . ./.env.local; set +a
key=$(head -n1 secrets/device-key)
[ -n "$key" ] || { echo "secrets/device-key is empty" >&2; exit 1; }
curl -fsS -u "$ORTHANC_USER:$ORTHANC_PASSWORD" http://127.0.0.1:8042/studies | tr -d '[]" \n' | tr ',' '\n' | while read -r id; do
  [ -n "$id" ] || continue
  printf '%s ' "$id"
  curl -sS -X POST "$ucc/api/pacs/orthanc/study?wait=1" -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
    -d "{\"orthancStudyId\":\"$id\"}" | cut -c1-200
  echo
done
