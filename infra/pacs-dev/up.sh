#!/usr/bin/env bash
# Start the dev PACS (compose project ucc-pacs-dev). Creates .env.local with random secrets on first
# run (never printed). Usage:
#   ./up.sh                               start (UCC dev server expected on 127.0.0.1:3210)
#   UCC_UPSTREAM=127.0.0.1:3357 ./up.sh   point the viewer/relay at another local UCC port
#   ./up.sh down                          stop (keeps the orthanc-db volume)
#   ./up.sh ucc-env >> ../../.env.local   append the PACS_* server env UCC needs (secrets; never to a terminal)
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
  } > .env.local
fi
# ./secrets (git-ignored, mode 700):
#   device-key     the X-ray Device key issued in UCC (one line). The Lua hook reads it on every
#                  event, so rotating the key needs no restart. Mounted read-only into Orthanc.
#   viewer-secret  UCC's viewer-token signing secret. Kept in ./viewer-secret, outside the mounted
#                  directory, so Orthanc never sees it.
mkdir -p secrets && chmod 700 secrets
[ -f secrets/device-key ] || ( umask 077; : > secrets/device-key )
[ -s viewer-secret ] || ( umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48 > viewer-secret )
if [ "${1:-}" = ucc-env ]; then
  # Server env for the UCC app. Contains secrets: redirect it, e.g.  ./up.sh ucc-env >> ../../.env.local
  if [ -t 1 ]; then echo "refusing to print secrets to a terminal; redirect to UCC's .env.local" >&2; exit 1; fi
  . ./.env.local
  echo "# Dev PACS (infra/pacs-dev) - X-ray phase 3"
  echo "PACS_ORTHANC_URL=http://127.0.0.1:8042"
  echo "PACS_ORTHANC_USER=$ORTHANC_USER"
  echo "PACS_ORTHANC_PASSWORD=$ORTHANC_PASSWORD"
  echo "PACS_VIEWER_ORIGIN=http://127.0.0.1:3320"
  echo "PACS_VIEWER_SECRET=$(cat viewer-secret)"
  exit 0
fi
docker compose -p ucc-pacs-dev up -d
