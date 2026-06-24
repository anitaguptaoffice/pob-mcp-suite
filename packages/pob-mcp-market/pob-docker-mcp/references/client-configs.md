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
        "POB_DOCKER_IMAGE": "ghcr.io/anitaguptaoffice/pob-mcp:latest",
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
    "POB_DOCKER_IMAGE": "ghcr.io/anitaguptaoffice/pob-mcp:latest",
    "POB_LUA_ENABLED": "true"
  }
}
```

## Environment Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `POB_DOCKER_IMAGE` | `ghcr.io/anitaguptaoffice/pob-mcp:latest` | Docker image tag to run |
| `POB_DOCKER_BUILD` | `0` | Set to `1` to build the development Dockerfile locally instead of pulling |
| `POB_BUILDS_DIR` | `~/Documents/Path of Building/Builds` | Host builds directory mounted to `/builds` |
| `POB_MCP_REPO` | `https://github.com/anitaguptaoffice/pob-mcp.git` | pob-mcp source |
| `POB_MCP_REF` | `main` | pob-mcp branch/tag |
| `POB_REPO` | `https://github.com/anitaguptaoffice/PathOfBuilding.git` | PoB api-stdio source |
| `POB_REF` | `api-stdio` | PoB branch/tag |
| `POE_TRADE_ENABLED` | `false` | Enable live trade API tools |
