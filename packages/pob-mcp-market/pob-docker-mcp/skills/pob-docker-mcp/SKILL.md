---
name: pob-docker-mcp
description: Use when analyzing, comparing, editing, or optimizing Path of Building builds through the PoB Docker MCP server, including Claude CLI, Codex, and CodeBuddy workflows.
---

# PoB Docker MCP

Use this skill when the user wants Path of Building help and the `pob` MCP server is available or should be started through Docker.

This skill is the Codex-facing operating guide for the plugin. The MCP tool schemas describe what each tool accepts; this skill explains which tools to trust for each job and what to verify before reporting results.

## Runtime

The plugin provides a stdio MCP server named `pob`.

Default command:

```bash
./scripts/pob-mcp-docker.sh
```

The command pulls the published Docker image on first run, then runs `pob-mcp-server` with:

- `POB_LUA_ENABLED=true`
- `POB_FORK_PATH=/opt/PathOfBuilding/src`
- `POB_DIRECTORY=/builds`
- host builds mounted from `POB_BUILDS_DIR`, defaulting to `~/Documents/Path of Building/Builds`

## Recommended Workflow

1. Confirm the user has a PoB XML file or a build in the mounted builds directory.
2. Use `list_builds` when the user refers to a saved build by name.
3. For pobb.in URLs, decode or import the build XML first, then place it in the mounted builds directory before using MCP tools.
4. Load the build through Lua when possible before drawing conclusions:
   - `lua_load_build`
   - `lua_get_build_info`
   - `lua_get_stats`
   - `lua_get_tree`
   - `lua_get_items`
   - `lua_get_skills`
5. Use non-Lua tools for broader static reports and file operations:
   - `analyze_build`
   - `compare_builds`
   - `validate_build`
   - `get_build_notes`
   - `set_build_notes`
   - `snapshot_build`
   - `export_build`
6. Explain changes in PoB terms: DPS, effective hit pool, resistances, ailment mitigation, tree pathing, gem links, flask uptime, and cost.

For detailed tool selection, verification, and known edge cases, read `../../references/tool-workflows.md`.

## Tool Trust Model

- Prefer Lua-backed tools for calculated stats, selected class, ascendancy names, tree version, item sets, skill setups, config, and mutation previews.
- Treat XML/static analysis as useful context, not final truth, when it conflicts with Lua output.
- Treat trade and poe.ninja output as live external data that may be stale or disabled by environment flags.
- Treat passive point legality from static analysis as advisory only for alternate trees.
- When build data comes from pobb.in or an official passive tree URL, cross-check level, tree version, passive count, class, and ascendancy against the source before making claims.

## Common Tool Groups

Use Lua-backed tools whenever available because they use real PoB calculations:

   - `lua_load_build`
   - `lua_get_build_info`
   - `lua_get_stats`
   - `lua_get_tree`
   - `lua_set_tree`
   - `lua_update_tree_delta`
   - `lua_get_items`
   - `lua_get_skills`

Use optimization tools only after loading or identifying the target build:

   - `suggest_optimal_nodes`
   - `optimize_tree`
   - `get_nearby_nodes`
   - `find_path_to_node`
   - `allocate_nodes`

Use mutation and export tools only after summarizing the intended change:

   - `lua_set_tree`
   - `lua_update_tree_delta`
   - `add_item`
   - `add_gem`
   - `set_main_skill`
   - `save_tree`
   - `snapshot_build`
   - `restore_snapshot`
   - `export_build`

## Guardrails

- Do not claim a DPS or defensive number unless it came from a PoB/Lua tool result or an explicitly provided build export.
- Before suggesting tree edits, check current tree version and allocated nodes.
- Before mutating a build, summarize the intended change and prefer snapshot/export tools when available.
- Treat trade and poe.ninja data as live external data; if the MCP has trade disabled, state that price guidance is approximate.
- If the Docker runtime is unavailable, ask the user to start Docker and rerun the MCP command.
- For `*_alternate` tree versions, do not infer build legality from static passive point counts alone. Use PoB/Lua or the official tree link as the source of truth.
- If `analyze_build` and Lua disagree on class, ascendancy, tree version, or calculated stats, report the discrepancy and prefer Lua.

## Common Failures

**Docker image missing:** the script pulls it automatically. First run can take several minutes.

**Build not found:** confirm `POB_BUILDS_DIR` points to the directory containing `.xml` files.

**Lua bridge not enabled:** set `POB_LUA_ENABLED=true`.

**LuaJIT startup failure in container:** pull the latest image or pin a known-good tag:

```bash
POB_DOCKER_IMAGE=ghcr.io/anitaguptaoffice/pob-mcp:latest ./scripts/pob-mcp-docker.sh
```

**PoB data version mismatch:** prefer the latest published image from the `pob-mcp` repository after `api-stdio` is synced.

**Plugin docs vs skills:** Markdown under `references/` is supporting documentation. Codex only auto-triggers skills from `skills/*/SKILL.md`; references are read when the skill points to them or when the task requires them.

## Response Style

Keep answers build-focused. Lead with the concrete finding, then list the exact PoB changes to try. When results depend on budget, ask for the budget before recommending market purchases.
