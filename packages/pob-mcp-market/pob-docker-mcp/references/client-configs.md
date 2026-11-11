# Client Configurations

Use the same Docker stdio command for Claude CLI, Codex, and CodeBuddy.

Replace `/ABS/PATH/TO/pob-docker-mcp` with the installed plugin path.
During migration, select a locally built image containing the snapshot service;
the published `latest` tag may still contain only the existing service. The
examples below require setting `POB_DOCKER_IMAGE` to that local image.

## Claude CLI / Claude Desktop style

```json
{
  "mcpServers": {
    "pob": {
      "command": "/ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh",
      "args": [],
      "env": {
        "POB_BUILDS_DIR": "/Users/YOU/Documents/Path of Building/Builds",
        "POB_DOCKER_IMAGE": "pob-mcp-suite:foundation-local",
        "POB_FOUNDATION_ENABLED": "true",
        "POB_LUA_ENABLED": "true",
        "POE_TRADE_ENABLED": "true"
      }
    }
  }
}
```

## Codex plugin

Install the plugin from the marketplace entry, then enable the `pob` MCP server exposed by `.mcp.json`.

For local testing without marketplace install:

```bash
POB_DOCKER_IMAGE=pob-mcp-suite:foundation-local POB_FOUNDATION_ENABLED=true /ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh
```

## CodeBuddy

Use an MCP server entry equivalent to:

```json
{
  "name": "pob",
  "command": "/ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh",
  "args": [],
  "env": {
    "POB_BUILDS_DIR": "/Users/YOU/Documents/Path of Building/Builds",
    "POB_DOCKER_IMAGE": "pob-mcp-suite:foundation-local",
    "POB_FOUNDATION_ENABLED": "true",
    "POB_LUA_ENABLED": "true"
  }
}
```

## Environment Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `POB_DOCKER_IMAGE` | `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest` | Docker image tag to run |
| `POB_BUILDS_DIR` | `~/Documents/Path of Building/Builds` | Host builds directory mounted to `/builds` |
| `POB_FOUNDATION_ENABLED` | unset | Set to `true` to enable snapshot mode in an image that supports it |
| `POB_LEGACY_ENABLED` | unset | Set to `true` only for legacy compatibility; independent Trade tools are disabled while legacy mode is enabled |
| `POB_DOCKER_USER` | unset | Optional Docker `--user` value, such as `1000:1000`, for host-owned build and snapshot files |
| `POE_TRADE_ENABLED` | `false` in the wrapper, `true` in the bundled Codex plugin | Enable live trade API tools |

For image development, build the repository's root Dockerfile and set
`POB_DOCKER_IMAGE` to the resulting local tag. The packaged configuration keeps
using the published image unless explicitly overridden.

The image otherwise runs as root and may create root-owned files in the mounted
build directory. On Linux, set `POB_DOCKER_USER` to the host UID and GID (for
example `$(id -u):$(id -g)` in a shell) if the mounted directory and existing
snapshot store are writable by that identity. This does not change ownership of
previous files. Check the Docker host's file-sharing semantics on other systems.
