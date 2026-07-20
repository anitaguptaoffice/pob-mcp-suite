#!/usr/bin/env bash
set -euo pipefail

IMAGE="${POB_DOCKER_IMAGE:-ghcr.io/anitaguptaoffice/pob-mcp-suite:latest}"
BUILDS_DIR="${POB_BUILDS_DIR:-${HOME}/Documents/Path of Building/Builds}"

if ! command -v docker >/dev/null 2>&1; then
  echo "pob-docker-mcp: docker is required but was not found in PATH" >&2
  exit 127
fi

mkdir -p "${BUILDS_DIR}"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "pob-docker-mcp: pulling ${IMAGE}" >&2
  docker pull "${IMAGE}"
fi

exec docker run --rm -i \
  -e POB_DIRECTORY=/builds \
  -e POB_FORK_PATH=/opt/PathOfBuilding/src \
  -e POB_LUA_ENABLED="${POB_LUA_ENABLED:-true}" \
  -e POB_CMD="${POB_CMD:-luajit}" \
  -e POE_TRADE_ENABLED="${POE_TRADE_ENABLED:-false}" \
  -e POE_RATE_LIMIT_PER_SECOND="${POE_RATE_LIMIT_PER_SECOND:-4}" \
  -e POE_CACHE_TTL="${POE_CACHE_TTL:-300}" \
  -v "${BUILDS_DIR}:/builds" \
  "${IMAGE}"
