#!/usr/bin/env bash
# Start the dev PACS (compose project ucc-pacs-dev). Creates .env.local with random secrets on first
# run (never printed). Usage:
#   ./up.sh                               start (UCC dev server expected on 127.0.0.1:3210)
#   UCC_UPSTREAM=127.0.0.1:3357 ./up.sh   point the viewer/relay at another local UCC port
#   ./up.sh down                          stop (keeps the orthanc-db volume)
set -euo pipefail
cd "$(dirname "$0")"
if [ "${1:-}" = down ]; then exec docker compose -p ucc-pacs-dev down; fi
if [ ! -f .env.local ]; then
  umask 077
  pw=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
  {
    echo "ORTHANC_USER=ucc"
    echo "ORTHANC_PASSWORD=$pw"
    echo "ORTHANC__REGISTERED_USERS={\"ucc\":\"$pw\"}"
    # Orthanc reaches UCC through the nginx relay on the pacs bridge gateway (see docker-compose.yml).
    echo "UCC_INGRESS_URL=http://172.31.57.1:3321/api/pacs/orthanc/study"
    echo "UCC_DEVICE_KEY="   # paste the X-ray Device key issued in UCC, then run ./up.sh again
  } > .env.local
fi
docker compose -p ucc-pacs-dev up -d
