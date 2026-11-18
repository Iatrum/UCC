#!/usr/bin/env bash
# Rehearsal proxy for staging (plan 385d). Requires staging Medplum already up (infra/staging/up.sh).
#   ./rehearse.sh [up|down|config]    TRAEFIK_IMAGE_TAG must be a pinned tag (not latest) in the environment.
set -euo pipefail
cd "$(dirname "$0")"
P=ucc-staging-rehearsal
case "${1:-up}" in
  config) TRAEFIK_IMAGE_TAG=${TRAEFIK_IMAGE_TAG:-0.0.0-placeholder} docker compose -p "$P" config -q && echo "compose config OK" ;;
  down) TRAEFIK_IMAGE_TAG=${TRAEFIK_IMAGE_TAG:-down-only} exec docker compose -p "$P" down ;;
  up)
    case "${TRAEFIK_IMAGE_TAG:-}" in ""|latest) echo "Set TRAEFIK_IMAGE_TAG to a pinned tag" >&2; exit 1 ;; esac
    docker network inspect ucc-staging_stg-net >/dev/null 2>&1 || { echo "Start staging first: infra/staging/up.sh" >&2; exit 1; }
    a=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    [ "$a" -ge "${STG_MIN_AVAILABLE_MB:-600}" ] || { echo "Refusing: MemAvailable ${a} MB too low" >&2; exit 1; }
    docker compose -p "$P" up -d
    echo "Rehearsal proxy: http://127.0.0.1:8180/  then: bash scripts/staging/probe.sh" ;;
  *) echo "usage: $0 [up|down|config]" >&2; exit 2 ;;
esac
