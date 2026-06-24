#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKERFILE="${PLUGIN_DIR}/assets/docker/Dockerfile"

IMAGE="${POB_DOCKER_IMAGE:-ghcr.io/anitaguptaoffice/pob-mcp:latest}"
BUILDS_DIR="${POB_BUILDS_DIR:-${HOME}/Documents/Path of Building/Builds}"
POB_MCP_REPO="${POB_MCP_REPO:-https://github.com/anitaguptaoffice/pob-mcp.git}"
POB_REPO="${POB_REPO:-https://github.com/anitaguptaoffice/PathOfBuilding.git}"
POB_MCP_REF="${POB_MCP_REF:-main}"
POB_REF="${POB_REF:-api-stdio}"
POB_DOCKER_BUILD="${POB_DOCKER_BUILD:-0}"

if ! command -v docker >/dev/null 2>&1; then
  echo "pob-docker-mcp: docker is required but was not found in PATH" >&2
  exit 127
fi

mkdir -p "${BUILDS_DIR}"

if [ "${POB_DOCKER_BUILD}" = "1" ]; then
  if [ ! -f "${DOCKERFILE}" ]; then
    echo "pob-docker-mcp: Dockerfile not found at ${DOCKERFILE}" >&2
    exit 1
  fi

  echo "pob-docker-mcp: building ${IMAGE}; this can take several minutes on first run" >&2
  docker build \
    --build-arg "POB_MCP_REPO=${POB_MCP_REPO}" \
    --build-arg "POB_REPO=${POB_REPO}" \
    --build-arg "POB_MCP_REF=${POB_MCP_REF}" \
    --build-arg "POB_REF=${POB_REF}" \
    -t "${IMAGE}" \
    -f "${DOCKERFILE}" \
    "${PLUGIN_DIR}"
elif ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
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
