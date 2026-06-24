# Troubleshooting

Use this reference when the MCP output looks wrong, Docker fails, or a build does not match pobb.in or PoB.

## Build Not Found

Check:

- `POB_BUILDS_DIR` points to the host directory containing `.xml` files.
- The plugin script mounts that directory to `/builds`.
- The filename passed to the MCP tool exactly matches the saved XML filename.

Use `list_builds` before assuming a build is missing.

## Lua Bridge Problems

Check:

- `POB_LUA_ENABLED=true`
- `POB_FORK_PATH=/opt/PathOfBuilding/src` inside the Docker image
- `POB_CMD=luajit`
- The Docker image is current enough to include the expected PoB API actions.

If Lua fails to start, pull the latest image or pin a known image tag and retry.

## Static Analysis Disagrees With Lua

Prefer Lua output for:

- DPS
- defenses
- class and ascendancy display names
- tree version
- selected item set and skill set
- config-sensitive stats

Use static analysis as context only when it conflicts with PoB/Lua.

## pobb.in Or Official Tree Mismatch

Compare:

- build level
- tree version
- class and ascendancy names
- passive count from source page
- XML `Build` and `Spec` metadata
- `lua_get_tree` output

For alternate trees, node-level legacy ascendancy labels and static passive point counts can be misleading.

## Docker Runtime

The plugin default image is:

```text
ghcr.io/anitaguptaoffice/pob-mcp-suite:latest
```

Useful checks:

```bash
docker pull ghcr.io/anitaguptaoffice/pob-mcp-suite:latest
docker image inspect ghcr.io/anitaguptaoffice/pob-mcp-suite:latest
```

If Docker is unavailable, ask the user to start Docker and rerun the MCP command.
