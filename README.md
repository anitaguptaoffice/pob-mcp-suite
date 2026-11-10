# PoB MCP Suite

This monorepo contains the complete Path of Building MCP delivery chain:

| Path | Responsibility |
| --- | --- |
| `vendor/PathOfBuilding` | Unmodified vendored Path of Building runtime. |
| `packages/pob-mcp` | TypeScript MCP server and Docker runtime source. |
| `packages/pob-mcp-market` | Codex plugin, skill, marketplace metadata, and client wrapper scripts. |

The goal of this repository is to replace the previous three-repository release chain with one source of truth. Docker images are built from the checked-in PoB vendor tree instead of cloning another repository during image build. The repo-owned Lua adapter under `packages/pob-mcp/lua` is based on ianderse/pob-mcp revision `67c3404fc6062bcfe3f690073ec25fd0daa454de`. The suite-specific Timeless Jewel seed search lives in its own `timeless_jewel.lua` module, and dynamic class and ascendancy names are returned by the adapter. Docker builds the PoB-compatible LuaJIT revision used by SimpleGraphic.

See [UPSTREAM_MCP_CHANGES.md](UPSTREAM_MCP_CHANGES.md) for the upstream baseline, suite-specific changes, and regression coverage.

## Local Validation

```bash
npm --prefix packages/pob-mcp ci
npm run validate
docker build -t pob-mcp-suite:local .
docker run --rm --entrypoint node -e POB_LUA_ENABLED=true -e POE_TRADE_ENABLED=false pob-mcp-suite:local /opt/pob-mcp/scripts/mcp-smoke.mjs node /opt/pob-mcp/build/index.js
docker run --rm --entrypoint node pob-mcp-suite:local /opt/pob-mcp/scripts/engine-regression.mjs
```

## Release Shape

- Root CI validates the MCP package and Codex plugin package.
- Root Docker workflow builds the image from `vendor/PathOfBuilding` and `packages/pob-mcp`.
- The Codex plugin continues to run `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest` by default.
- Previous standalone repositories are legacy references; active source, plugin, sync, and publishing changes belong in this monorepo.

## Vendor Synchronization

`.github/workflows/sync-pob.yml` syncs the Path of Building Community `dev` branch every Monday. After merging the vendor subtree, it validates the zlib-compressed `src/Data/TimelessJewelData/ElegantHubris.zip`, records its SHA-256 and whether it changed, and runs an engine smoke test before publishing a fresh Docker image. Conflicts or compatibility failures require manual repair.
