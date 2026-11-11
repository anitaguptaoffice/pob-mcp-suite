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

The command refreshes registry image tags at startup and falls back to an
existing local image with a warning if the update fails. Digest references stay
pinned; unnamespaced local development tags are not refreshed. Initial downloads
have a separate timeout budget. See `../../references/client-configs.md` for
these settings. The command runs `pob-mcp-server` with:

- `POB_PATH=/opt/PathOfBuilding/src`
- `POB_DIRECTORY=/builds`
- host builds mounted from `POB_BUILDS_DIR`, defaulting to `~/Documents/Path of Building/Builds`

Snapshot data is stored beneath the mounted build directory. See
`../../references/client-configs.md` for local test configuration; the packaged
plugin's default targets the published image.

## Recommended Workflow

First inspect the server's advertised tools and use the explicit snapshot workflow
in `../../references/snapshot-workflows.md`. Build operations after import must
name their snapshot; do not assume an implicitly loaded build. If a requested
operation has no advertised equivalent, say it is unavailable. Explain results
in PoB terms, including the calculation context, uncertainty and the limits of
any price or uptime assumptions.

For detailed tool selection, verification, and known edge cases, read the relevant reference:

- `../../references/tool-workflows.md` for source-of-truth, build intake, mutation, and alternate tree rules.
- `../../references/tree-optimization.md` for passive tree recommendations and reallocation.
- `../../references/trade-tools.md` for trade searches, price checks, and gear upgrades.
- `../../references/troubleshooting.md` for Docker, engine, pobb.in, and mismatch triage.
- For build budgets, trade estimates, and crafting costs, use the separate `pob-economy` skill in `../pob-economy/SKILL.md`.
- For crafting rules and probability assumptions, use the separate `pob-crafting` skill in `../pob-crafting/SKILL.md`.

## Tool Trust Model

- Prefer PoB calculation tools for calculated stats, selected class, ascendancy names, tree version, item sets, skill setups, config, and mutation previews.
- Treat XML/static analysis as useful context, not final truth, when it conflicts with PoB calculation output.
- Treat trade and poe.ninja output as live external data that may be stale or disabled by environment flags.
- Treat passive point legality from static analysis as advisory only for alternate trees.
- When build data comes from pobb.in or an official passive tree URL, cross-check level, tree version, passive count, class, and ascendancy against the source before making claims.

## Guardrails

- Do not claim a DPS or defensive number unless it came from a PoB calculation result or an explicitly provided build export.
- Before suggesting tree edits, check current tree version and allocated nodes. Use `foundation_inspect` with `tree` and derive an explicit child; see the snapshot workflow.
- Before mutating a build, summarize the intended change; mutations create a child snapshot, so state which child you are reporting on.
- Treat trade and poe.ninja data as live external data; if the MCP has trade disabled, state that price guidance is approximate.
- Before building a non-unique item search, use `search_trade_stats` when advertised. Do not assume an `explicit.stat_*` filter also matches identically worded `Implicit`, `Fractured`, `Crafted`, or `Enchant` stats.
- Prefer a suitable `Pseudo` total when one exists. Otherwise put compatible source variants for one semantic requirement in one `count`/`or` group, and keep separate mandatory requirements in separate groups. Do not mechanically add every same-text source to named unique searches.
- Use `status=securable` when the user asks for instant-buyout or immediately purchasable listings.
- If the Docker runtime is unavailable, ask the user to start Docker and rerun the MCP command.
- For `*_alternate` tree versions, do not infer build legality from static passive point counts alone. Use PoB calculations or the official tree link as the source of truth.

## Common Failures

**Docker image missing:** the script pulls it automatically. First run can take several minutes.

**Build not found:** confirm `POB_BUILDS_DIR` points to the directory containing `.xml` files.

**LuaJIT startup failure in container:** pull the latest image or pin a known-good tag:

```bash
POB_DOCKER_IMAGE=ghcr.io/anitaguptaoffice/pob-mcp-suite:latest ./scripts/pob-mcp-docker.sh
```

**PoB data version mismatch:** pull the latest image published by `pob-mcp-suite` after its vendored Path of Building tree is synced.

**Plugin docs vs skills:** Markdown under `references/` is supporting documentation. Codex only auto-triggers skills from `skills/*/SKILL.md`; references are read when the skill points to them or when the task requires them.

## Response Style

Use Simplified Chinese for user-facing answers and established Simplified Chinese names for game concepts. When a name is uncertain, check the appropriate game and version on https://poedb.tw/cn/; do not invent translations. Retain original names or IDs where they help disambiguate, and explain jargon for beginners. Keep tool names and other machine-facing identifiers unchanged.

Keep answers build-focused. Lead with the concrete finding, then list the exact PoB changes to try. When results depend on budget, ask for the budget before recommending market purchases.
