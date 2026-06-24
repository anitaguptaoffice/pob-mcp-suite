# PoB MCP Suite

This monorepo contains the complete Path of Building MCP delivery chain:

| Path | Responsibility |
| --- | --- |
| `vendor/PathOfBuilding` | Vendored `api-stdio` Path of Building fork used by the Lua bridge. |
| `packages/pob-mcp` | TypeScript MCP server and Docker runtime source. |
| `packages/pob-mcp-market` | Codex plugin, skill, marketplace metadata, and client wrapper scripts. |

The goal of this repository is to replace the previous three-repository release chain with one source of truth. Docker images are built from the checked-in PoB vendor tree instead of cloning another repository during image build.

## Local Validation

```bash
npm --prefix packages/pob-mcp ci
npm run validate
docker build -t pob-mcp-suite:local .
docker run --rm --entrypoint node -e POB_LUA_ENABLED=true -e POE_TRADE_ENABLED=false pob-mcp-suite:local /opt/pob-mcp/scripts/mcp-smoke.mjs node /opt/pob-mcp/build/index.js
```

## Release Shape

- Root CI validates the MCP package and Codex plugin package.
- Root Docker workflow builds the image from `vendor/PathOfBuilding` and `packages/pob-mcp`.
- The Codex plugin continues to run `ghcr.io/anitaguptaoffice/pob-mcp:latest` by default.
- Existing standalone repositories can remain online during migration, but new changes should land here first.
