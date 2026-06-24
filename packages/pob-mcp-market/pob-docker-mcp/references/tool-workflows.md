# PoB MCP Tool Workflows

This reference is for agent operation. It complements MCP tool schemas with policy about which outputs to trust and what to verify.

## Docs, References, And Skills

- A Codex skill is discovered from `skills/<skill-name>/SKILL.md`.
- Files under `references/` are not automatically triggered as skills.
- Reference files are useful for detailed procedures that would make `SKILL.md` too large.
- MCP tool descriptions are API documentation for tool calls, not an agent operating procedure.

The plugin should keep `SKILL.md` as the short entry point and put longer workflows here.

## Build Intake

For saved builds:

1. Use `list_builds` if the user gives a build name but not the exact filename.
2. Use `lua_load_build` when Lua is enabled.
3. Use `lua_get_build_info`, `lua_get_stats`, and `lua_get_tree` before making high-confidence claims.
4. Use `analyze_build` for a broad static report, then reconcile it with Lua output.

For pobb.in builds:

1. Decode or import the XML.
2. Save the XML into the mounted `POB_BUILDS_DIR`.
3. Check the source page or encoded XML for level, passive count, class, ascendancy, and tree version.
4. Load the saved XML through `lua_load_build`.
5. Compare Lua output with source metadata before analysis.

## Preferred Sources Of Truth

Use this order when outputs disagree:

1. Real PoB/Lua output from the loaded build.
2. Build XML metadata, especially `className`, `ascendClassName`, `Spec treeVersion`, `classId`, `ascendClassId`, and `secondaryAscendClassId`.
3. Official passive tree or pobb.in metadata.
4. Static MCP analysis.
5. Heuristic recommendations.

Do not silently merge conflicting outputs. State the discrepancy and continue with the most reliable source.

## Alternate Tree Handling

Alternate tree versions such as `3_28_alternate` can use event-specific ascendancy names and point accounting.

Known risks:

- Node-level data can preserve legacy internal ascendancy labels even when the build's real ascendancy name is alternate-event specific.
- Static passive point counting can overcount or undercount because it does not fully model event-specific point rules.
- XML `ascendClassId` can map to a different display name under alternate tree data than it does under the standard tree.

Required handling:

- Prefer `lua_get_tree` and `lua_get_build_info` for class and ascendancy display names.
- Prefer build XML `ascendClassName` when Lua exposes it.
- Do not mark `118 / 115 available`-style output as invalid for alternate trees unless PoB itself reports the allocation is invalid.
- If static output says a build is over budget but the tree version ends with `_alternate`, describe it as an unreliable static estimate.

## Calculated Stats

Use Lua-backed tools for:

- DPS
- EHP and maximum hit
- resistances after config
- ailment avoidance or mitigation
- flask effects
- skill damage selection
- item set and skill set effects
- enemy/config-sensitive values

Avoid presenting XML-only stats as final when the user asks for optimization or correctness.

## Tree Changes

Before changing a tree:

1. Load the build through Lua.
2. Read `lua_get_tree`.
3. Snapshot or export the build when the tool exists.
4. Explain intended node additions/removals.
5. Apply the smallest change first.
6. Re-read stats and tree after mutation.

For recommendations:

- Use `suggest_optimal_nodes` for ranked candidates.
- Use `get_nearby_nodes` and `find_path_to_node` to explain pathing.
- Use `lua_update_tree_delta` or allocation tools for what-if checks.
- Do not recommend expensive respecs without showing point cost and stat delta.

## Gear And Gems

For item or gem work:

1. Use `lua_get_items` and `lua_get_skills` for current state.
2. Use static analysis only to summarize broad structure.
3. For item paste tests, apply one item at a time when possible.
4. Recalculate after each meaningful change.
5. Include both gain and lost stats in the answer.

## Trade Tools

Trade is optional and environment gated.

- If `POE_TRADE_ENABLED=false`, do not claim live market prices.
- If trade tools are enabled, mention league and timestamp-sensitive uncertainty.
- Prefer bounded searches with price caps, online filters, and concrete stat requirements.
- Do not treat search results as complete market truth.

## Failure Triage

If MCP output looks wrong:

1. Check whether Lua tools are enabled.
2. Check Docker image tag and digest.
3. Check `POB_BUILDS_DIR` and whether the XML file is the expected build.
4. Compare `lua_get_tree` with XML `Spec` metadata.
5. Compare `analyze_build` with Lua output.
6. For alternate trees, suspect static tree analysis before suspecting PoB calculation output.
7. If image freshness matters, pull or pin the intended Docker image manually.

## Minimal Verification For Plugin Changes

Run these after changing the plugin package:

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

Run Docker smoke only when Docker and network/image access are available:

```bash
pob-docker-mcp/scripts/smoke-test.sh
```
