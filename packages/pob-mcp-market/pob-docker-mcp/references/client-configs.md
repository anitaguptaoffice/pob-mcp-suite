# Client configurations

Use the same Docker stdio command for Claude CLI, Codex, CodeBuddy and OpenCode.

Replace `/ABS/PATH/TO/pob-docker-mcp` with the installed plugin path. The
published `latest` image must contain the current snapshot service; pin
`POB_DOCKER_IMAGE` to a specific tag when you need a reproducible build.

## Claude CLI / Claude Desktop style

```json
{
  "mcpServers": {
    "pob": {
      "command": "/ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh",
      "args": [],
      "env": {
        "POB_BUILDS_DIR": "/Users/YOU/Documents/Path of Building/Builds",
        "POB_DOCKER_IMAGE": "ghcr.io/anitaguptaoffice/pob-mcp-suite:latest",
        "POE_TRADE_ENABLED": "true"
      }
    }
  }
}
```

## Codex plugin

Install the plugin from the marketplace entry, then enable the `pob` MCP server
exposed by `.mcp.json`.

For local testing without marketplace install:

```bash
POB_DOCKER_IMAGE=pob-mcp-suite:local /ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh
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
    "POB_DOCKER_IMAGE": "ghcr.io/anitaguptaoffice/pob-mcp-suite:latest"
  }
}
```

## OpenCode 2

From the project directory, register the local wrapper and reload the running
OpenCode service. Replace the paths and image with your own values:

```bash
opencode mcp add --env POB_BUILDS_DIR=/ABS/PATH/TO/BUILDS --env POB_DOCKER_IMAGE=pob-mcp-suite:local pob -- /ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh
opencode reload
opencode mcp list
```

OpenCode 2 stores these entries under `mcp.servers`; see its
[MCP configuration documentation](https://opencode.ai/docs/mcp-servers).
The repository's `packages/pob-mcp-market/scripts/smoke-opencode-wrapper.mjs`
tests an import and Life calculation with a local image, temporary client
configuration and a deterministic model stub. It does not validate real-model
tool selection or the user's installed configuration.

## Environment variables

For an isolated installed `mcporter` client check, build a local image and run
`POB_DOCKER_IMAGE=pob-mcp-suite:local MCPORTER_BIN=/path/to/mcporter node packages/pob-mcp-market/scripts/smoke-mcporter-wrapper.mjs`
from the repository root. It uses an ad-hoc server, an isolated build directory
and a fresh client process for each tool call; it does not change the installed
`pob` configuration or switch the running service. It runs the container with
the current numeric UID/GID so temporary files can be removed. With an ad-hoc
stdio server, use `mcporter call --tool NAME` rather than a qualified
`server.NAME` selector.

| Variable | Default | Meaning |
| --- | --- | --- |
| `POB_DOCKER_IMAGE` | `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest` | Docker image tag to run |
| `POB_BUILDS_DIR` | `~/Documents/Path of Building/Builds` | Host builds directory mounted to `/builds` |
| `POB_DOCKER_USER` | unset | Optional Docker `--user` value, such as `1000:1000`, for host-owned build and snapshot files |
| `POE_TRADE_ENABLED` | `false` in the wrapper, `true` in the bundled Codex plugin | Enable official Trade tools |
| `POE_SESSION_ID` | unset | `POESESSID` cookie for authenticated Trade queries |

For image development, build the repository's root Dockerfile and set
`POB_DOCKER_IMAGE` to the resulting local tag. The packaged configuration keeps
using the published image unless explicitly overridden.

The image otherwise runs as root and may create root-owned files in the mounted
build directory. On Linux, set `POB_DOCKER_USER` to the host UID and GID (for
example `$(id -u):$(id -g)` in a shell) if the mounted directory and existing
snapshot store are writable by that identity. This does not change ownership of
previous files. Check the Docker host's file-sharing semantics on other systems.
