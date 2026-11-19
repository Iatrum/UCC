#!/usr/bin/env bash
# Task 663: run the 385d allowlist (infra/staging/rehearsal/dynamic) as a throwaway loopback Traefik in front of the
# DEV Medplum (container ucc-dev-medplum, compose project ucc-medplum-dev), probe it, rehearse a successful invite, tear down.
# Touches only ucc-663-traefik. Never medplum-*, root-traefik-1, /opt/medplum or /root. Fake data only.
#   TRAEFIK_IMAGE_TAG=v3.5.0 bash scripts/staging/rehearse-invite-dev.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
case "${TRAEFIK_IMAGE_TAG:-}" in ""|latest) echo "Set TRAEFIK_IMAGE_TAG to a pinned tag" >&2; exit 1 ;; esac
NET=ucc-medplum-dev; UP=ucc-dev-medplum; C=ucc-663-traefik
docker inspect "$UP" >/dev/null || { echo "dev Medplum $UP not running" >&2; exit 1; }
tmp=$(mktemp -d); trap 'docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
# same allowlist file, only the upstream differs
sed "s#http://ucc-stg-medplum:8103/#http://$UP:8113/#" infra/staging/rehearsal/dynamic/medplum-allowlist.yml > "$tmp/medplum-allowlist.yml"
chmod 755 "$tmp"; chmod 644 "$tmp/medplum-allowlist.yml"
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --network "$NET" --memory 128m --memory-swap 128m -p 127.0.0.1:8180:8000 \
  -v "$tmp:/etc/traefik/dynamic:ro" "traefik:$TRAEFIK_IMAGE_TAG" \
  --entrypoints.web.address=:8000 --providers.file.directory=/etc/traefik/dynamic --api=false --ping=false --accesslog=false >/dev/null
for _ in $(seq 1 20); do [ "$(curl -s -o /dev/null -m2 -w '%{http_code}' http://127.0.0.1:8180/healthcheck)" = 200 ] && break; sleep 1; done
bash scripts/staging/probe.sh
bun run scripts/staging/invite-rehearsal.ts
