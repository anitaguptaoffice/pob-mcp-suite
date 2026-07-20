# Client Configurations

Use the same Docker stdio command for Claude CLI, Codex, and CodeBuddy.

Replace `/ABS/PATH/TO/pob-docker-mcp` with the installed plugin path.

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
        "POB_LUA_ENABLED": "true",
        "POE_TRADE_ENABLED": "false"
      }
    }
  }
}
```

## Codex plugin

Install the plugin from the marketplace entry, then enable the `pob` MCP server exposed by `.mcp.json`.

For local testing without marketplace install:

```bash
/ABS/PATH/TO/pob-docker-mcp/scripts/pob-mcp-docker.sh
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
    "POB_DOCKER_IMAGE": "ghcr.io/anitaguptaoffice/pob-mcp-suite:latest",
    "POB_LUA_ENABLED": "true"
  }
}
```

## Environment Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `POB_DOCKER_IMAGE` | `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest` | Docker image tag to run |
| `POB_BUILDS_DIR` | `~/Documents/Path of Building/Builds` | Host builds directory mounted to `/builds` |
| `POE_TRADE_ENABLED` | `false` | Enable live trade API tools |

For image development, clone `https://github.com/anitaguptaoffice/pob-mcp-suite` and build the root Dockerfile. The installed plugin intentionally consumes published suite images only.
