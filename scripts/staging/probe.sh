#!/usr/bin/env bash
# Plan 385d probe kit, loopback version of plan 1.2. Read-only HTTP GETs + `ss`; changes nothing.
#   bash scripts/staging/probe.sh [proxy_base=http://127.0.0.1:8180]
# Exit 1 if any expectation fails. Staging only (refuses any base other than 127.0.0.1:8180 / :8123).
set -u
BASE=${1:-http://127.0.0.1:8180}
case "$BASE" in http://127.0.0.1:8180|http://127.0.0.1:8123) ;; *) echo "refusing non-staging base $BASE" >&2; exit 2 ;; esac
fail=0
code() { curl -sS --path-as-is -o /dev/null -m 10 -w '%{http_code}' "$BASE$1" 2>/dev/null || echo 000; }
expect() { # label path predicate(allow|deny)
  c=$(code "$2")
  if [ "$3" = allow ]; then case "$c" in 2*|3*|401|400) ok=1 ;; *) ok=0 ;; esac
  else case "$c" in 404|403) ok=1 ;; *) ok=0 ;; esac; fi
  [ "$ok" = 1 ] && echo "PASS $1 ($2 -> $c)" || { echo "FAIL $1 ($2 -> $c)"; fail=1; }
}
expect "health reachable" /healthcheck allow
expect "well-known reachable" /.well-known/jwks.json allow
expect "fhir reachable (auth required)" /fhir/R4/metadata allow
# denied: every Medplum mount form of admin, plus encodings and dashboards
for p in /admin/projects /api/admin/projects /projects/x/admin/invite /api/projects/x/admin/invite \
         //admin/projects /%61dmin/projects /auth/../admin/projects /%2e%2e/admin /admin%2fprojects \
         /dashboard/ /api/rawdata /metrics /openapi.json /fhir/../admin; do
  expect "denied path" "$p" deny
done
# listeners: staging must be loopback-only
if command -v ss >/dev/null; then
  for port in 8123 8180 5432 6379 8080; do
    bad=$(ss -tln "sport = :$port" 2>/dev/null | awk 'NR>1 {print $4}' | grep -vE '^(127\.0\.0\.1|\[::1\]):' || true)
    [ -z "$bad" ] && echo "PASS port $port not on a non-loopback address" || { echo "FAIL port $port listens on $bad"; fail=1; }
  done
fi
[ "$fail" = 0 ] && echo "PROBE OK" || { echo "PROBE FAIL"; exit 1; }
