# PoB MCP Market

This package contains the Path of Building MCP Codex plugin and client configuration bundle inside the `pob-mcp-suite` monorepo.

## Monorepo Sources

| Path | Responsibility |
| --- | --- |
| `vendor/PathOfBuilding` | Vendored Path of Building runtime with the stdio Lua bridge. |
| `packages/pob-mcp` | MCP server source. |
| `packages/pob-mcp-market` | Marketplace metadata, plugin files, skills, and client scripts. |
| `.github/workflows` | The only active CI, sync, and Docker publishing workflows. |

## Runtime

The plugin runs a stdio MCP server from Docker:

```bash
pob-docker-mcp/scripts/pob-mcp-docker.sh
```

By default the script pulls:

```text
ghcr.io/anitaguptaoffice/pob-mcp-suite:latest
```

Set `POB_DOCKER_IMAGE` to pin a release tag. For image development, clone the monorepo and build its root Dockerfile; the installed plugin consumes published suite images only.

## Validation

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

`smoke-test.sh` requires Docker and validates that the pulled image can answer MCP stdio requests.
