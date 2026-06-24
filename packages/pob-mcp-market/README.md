# PoB MCP Market

This repository packages the Path of Building MCP Docker runtime as a Codex plugin and client configuration bundle.

## Repositories

| Repository | Responsibility |
| --- | --- |
| `anitaguptaoffice/PathOfBuilding` | Maintains the `api-stdio` Path of Building fork used by the MCP Lua bridge. |
| `anitaguptaoffice/pob-mcp` | Maintains the MCP server source, Docker image, and GHCR publishing workflow. |
| `anitaguptaoffice/pob-mcp-market` | Maintains marketplace metadata, plugin files, skills, and client setup scripts. |

## Runtime

The plugin runs a stdio MCP server from Docker:

```bash
pob-docker-mcp/scripts/pob-mcp-docker.sh
```

By default the script pulls:

```text
ghcr.io/anitaguptaoffice/pob-mcp:latest
```

Set `POB_DOCKER_IMAGE` to pin a release tag. Set `POB_DOCKER_BUILD=1` only when developing the image locally from the plugin Dockerfile.

## Validation

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

`smoke-test.sh` requires Docker and validates that the pulled image can answer MCP stdio requests.
