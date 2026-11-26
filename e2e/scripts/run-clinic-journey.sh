#!/usr/bin/env bash
# Run the clinic journey on one local production build against fake dev Medplum.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."

for name in UCC_USER UCC_PASSWORD MEDPLUM_CLIENT_ID MEDPLUM_CLIENT_SECRET; do
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name for the fake local Medplum project." >&2
    exit 1
  fi
done

port=${UCC_E2E_PORT:-3210}
if [[ ! "$port" =~ ^[1-9][0-9]{3,4}$ ]] || ((port > 65535)); then
  echo 'Set UCC_E2E_PORT to a valid port between 1000 and 65535.' >&2
  exit 1
fi
if [[ -n "$(ss -H -ltn "( sport = :3210 or sport = :$port )")" ]]; then
  echo 'A local app is already listening on the dev port or the requested port.' >&2
  exit 1
fi

unset EMR_CLINIC_URL EMR_ADMIN_URL
export UCC_BASE_URL="http://127.0.0.1:$port"
export MEDPLUM_BASE_URL=http://127.0.0.1:8113/
export NEXT_PUBLIC_MEDPLUM_BASE_URL="$MEDPLUM_BASE_URL"
export NEXT_PUBLIC_BASE_DOMAIN=localhost COOKIE_DOMAIN=
export NEXT_PUBLIC_DISABLE_AUTH=false FOLLOW_UP_DELIVERY_MODE=manual
export NODE_OPTIONS=--max-old-space-size=3072 NEXT_TELEMETRY_DISABLED=1
report_root=${UCC_REPORTS:-$(mktemp -d /tmp/ucc-task1010-journey.XXXXXXXX)}
mkdir -p "$report_root"
export UCC_REPORTS="$report_root/artifacts"
curl --noproxy '*' --fail --silent --show-error --max-time 10 \
  "${MEDPLUM_BASE_URL}healthcheck" -o /dev/null

bun run build:ci
app_pid=
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill -TERM -- "-$app_pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 5; attempt++)); do
      if ! kill -0 -- "-$app_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    kill -KILL -- "-$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

setsid node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port "$port" \
  >"$report_root/next.log" 2>&1 &
app_pid=$!
for ((attempt = 0; attempt < 60; attempt++)); do
  if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
  if curl --noproxy '*' --fail --silent --max-time 2 "$UCC_BASE_URL/api/health/deep" -o /dev/null; then
    timeout --kill-after=15s 5m node_modules/.bin/playwright test --config e2e/playwright.task1008.config.ts
    exit
  fi
  sleep 1
done
echo "The local app did not become ready. See $report_root/next.log." >&2
exit 1
