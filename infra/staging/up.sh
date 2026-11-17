#!/usr/bin/env bash
# Staging Medplum (compose project ucc-staging). Fake data only; loopback ports only.
#   ./up.sh            check memory, generate secrets on first run (never printed), start
#   ./up.sh down       stop (keeps volumes)
#   ./up.sh guard      exit 1 and stop staging if MemAvailable < STG_MIN_AVAILABLE_MB (default 600)
#   ./up.sh config     validate the compose file only (no containers touched)
# Requires MEDPLUM_IMAGE_TAG (pinned, not "latest") in the environment or ../../.env.staging.local.
set -euo pipefail
cd "$(dirname "$0")"
P=ucc-staging
MIN=${STG_MIN_AVAILABLE_MB:-600}
avail() { awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo; }
case "${1:-up}" in
  down) exec docker compose -p "$P" down ;;
  config)
    MEDPLUM_IMAGE_TAG=${MEDPLUM_IMAGE_TAG:-0.0.0-placeholder} docker compose -p "$P" config -q && echo "compose config OK"; exit 0 ;;
  guard)
    a=$(avail)
    if [ "$a" -lt "$MIN" ]; then
      echo "MemAvailable ${a} MB < ${MIN} MB: stopping staging (production wins)" >&2
      docker compose -p "$P" down; exit 1
    fi
    echo "MemAvailable ${a} MB OK"; exit 0 ;;
  up) ;;
  *) echo "usage: $0 [up|down|guard|config]" >&2; exit 2 ;;
esac
# shellcheck disable=SC1091
[ -f ../../.env.staging.local ] && { set -a; . ../../.env.staging.local; set +a; }
case "${MEDPLUM_IMAGE_TAG:-}" in ""|latest|REPLACE*) echo "Set MEDPLUM_IMAGE_TAG to a pinned tag" >&2; exit 1 ;; esac
a=$(avail)
[ "$a" -ge "$MIN" ] || { echo "Refusing to start: MemAvailable ${a} MB < ${MIN} MB (stop dev Next/PACS first)" >&2; exit 1; }
rand() { head -c 36 /dev/urandom | base64 | tr -d '/+=\n' | head -c "$1"; }
if [ ! -f .env.staging.local ]; then
  umask 077
  { echo "POSTGRES_PASSWORD=$(rand 32)"; echo "REDIS_PASSWORD=$(rand 32)"; } > .env.staging.local
fi
mkdir -p secrets && chmod 700 secrets
if [ ! -f secrets/medplum.config.json ]; then
  ( umask 077
    . ./.env.staging.local
    SIGNING_PASSPHRASE=$(rand 32)
    SIGNING_KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -aes256 -pass "pass:$SIGNING_PASSPHRASE" 2>/dev/null)
    export POSTGRES_PASSWORD REDIS_PASSWORD SIGNING_PASSPHRASE SIGNING_KEY
    node -e '
      const e = process.env;
      console.log(JSON.stringify({
        port: 8103,
        baseUrl: "http://127.0.0.1:8123/",
        appBaseUrl: "http://127.0.0.1:3000/",
        storageBaseUrl: "http://127.0.0.1:8123/storage/",
        binaryStorage: "file:./binary/",
        signingKey: e.SIGNING_KEY, signingKeyPassphrase: e.SIGNING_PASSPHRASE,
        database: { host: "ucc-stg-pg", port: 5432, dbname: "medplum_staging", username: "medplum", password: e.POSTGRES_PASSWORD },
        redis: { host: "ucc-stg-redis", port: 6379, password: e.REDIS_PASSWORD },
        registerEnabled: false,
        logLevel: "INFO",
      }, null, 2));' > secrets/medplum.config.json )
fi
docker compose -p "$P" up -d
echo "Staging API: http://127.0.0.1:8123/ (loopback; use an SSH tunnel). Run './up.sh guard' periodically."
