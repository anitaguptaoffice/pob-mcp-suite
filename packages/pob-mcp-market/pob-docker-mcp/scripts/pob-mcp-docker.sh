#!/usr/bin/env bash
set -euo pipefail

IMAGE="${POB_DOCKER_IMAGE:-ghcr.io/anitaguptaoffice/pob-mcp-suite:latest}"
BUILDS_DIR="${POB_BUILDS_DIR:-${HOME}/Documents/Path of Building/Builds}"

if ! command -v docker >/dev/null 2>&1; then
  echo "pob-docker-mcp: docker is required but was not found in PATH" >&2
  exit 127
fi

mkdir -p "${BUILDS_DIR}"

HAVE_IMAGE=false
if docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  HAVE_IMAGE=true
fi

# Local tags have no namespace; namespaced tags are treated as registry images,
# including Docker Hub's implicit registry. Digests remain pinned.
REFRESH=false
if [[ "${IMAGE}" != *@sha256:* && "${IMAGE}" == */* ]]; then
  REFRESH=true
fi

pull_image() {
  local budget="${POB_IMAGE_PULL_TIMEOUT_SECONDS:-300}"
  if [[ "${HAVE_IMAGE}" == true ]]; then budget="${POB_IMAGE_UPDATE_TIMEOUT_SECONDS:-10}"; fi
  if [[ ! "${budget}" =~ ^[1-9][0-9]*$ ]] || (( budget > 3600 )); then
    echo "pob-docker-mcp: image timeout must be an integer from 1 to 3600 seconds" >&2
    return 2
  fi
  # Bash's clock works on macOS as well; no dependency on GNU timeout.
  docker pull "${IMAGE}" >&2 &
  local pull_pid=$! started=${SECONDS}
  while kill -0 "${pull_pid}" 2>/dev/null; do
    if (( SECONDS - started >= budget )); then
      kill -KILL "${pull_pid}" 2>/dev/null || true
      wait "${pull_pid}" 2>/dev/null || true
      echo "pob-docker-mcp: image pull timed out after ${budget} seconds" >&2
      return 124
    fi
    sleep 0.1
  done
  wait "${pull_pid}"
}

if [[ "${REFRESH}" == true || "${HAVE_IMAGE}" == false ]]; then
  echo "pob-docker-mcp: checking ${IMAGE}" >&2
  if pull_image; then PULLED=true; else PULLED=false; fi
  if [[ "${PULLED}" == false ]]; then
    if [[ "${HAVE_IMAGE}" == true ]]; then
      echo "pob-docker-mcp: update failed; using the existing local image" >&2
    else
      echo "pob-docker-mcp: image pull failed and no local image is available" >&2
      exit 1
    fi
  fi
fi

if [[ -n "${POB_DOCKER_USER:-}" ]]; then
  set -- --user "${POB_DOCKER_USER}"
else
  set --
fi

exec docker run --rm -i \
  "$@" \
  -e POB_DIRECTORY=/builds \
  -e POB_PATH=/opt/PathOfBuilding/src \
  -e POB_CMD="${POB_CMD:-luajit}" \
  -e POE_TRADE_ENABLED="${POE_TRADE_ENABLED:-false}" \
  -e POE_SESSION_ID \
  -e POE_RATE_LIMIT_PER_SECOND="${POE_RATE_LIMIT_PER_SECOND:-4}" \
  -v "${BUILDS_DIR}:/builds" \
  "${IMAGE}"
