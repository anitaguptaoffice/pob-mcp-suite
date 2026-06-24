# Tree Optimization Workflows

Use this reference when the user asks where to spend passives, how to path to nodes, or whether a tree edit is worth making.

## Tool Selection

- Use `lua_load_build`, `lua_get_tree`, and `lua_get_stats` before recommending changes.
- Use `suggest_optimal_nodes` for ranked candidate nodes.
- Use `get_nearby_nodes` to discover reachable notables and keystones.
- Use `find_path_to_node` to explain the travel cost to a specific node.
- Use `optimize_tree` only when the user asks for broad reallocation, not for a small next-point recommendation.
- Use mutation tools only after explaining the planned edit and point cost.

## Optimization Goals

Common goals:

- `maximize_dps` for total damage.
- `maximize_hit_dps` for hit-focused builds.
- `maximize_dot_dps` for damage-over-time builds.
- `maximize_life`, `maximize_es`, and `maximize_ehp` for defenses.
- `resistances`, `armour`, `evasion`, `block`, and `spell_block` for defensive gaps.
- `balanced` when the user wants offense and defense together.
- `league_start` when survivability should be weighted higher than damage.

Map natural language to explicit goals:

- "more damage" -> `maximize_dps`
- "more life" -> `maximize_life`
- "tankier" -> `maximize_ehp`
- "crit multi" -> `crit_multi`
- "fix resists" -> `resistances`

## Recommendation Workflow

1. Load the build through Lua.
2. Read current tree metadata and tree version.
3. Read current stats for the relevant damage or defense category.
4. Run `suggest_optimal_nodes` with a narrow goal.
5. For each candidate, report point cost, expected stat gain, and any pathing tradeoff.
6. Prefer one small edit or a ranked shortlist over broad tree rewrites.

## Full Reallocation Workflow

Use `optimize_tree` when the user explicitly asks to rework the tree.

Before running it:

- Ask for the goal if it is ambiguous.
- Preserve build-defining keystones, jewel sockets, and required travel nodes.
- Use constraints for minimum life, ES, EHP, or resistances when the build has defensive requirements.
- For low-life builds, prefer `minEHP` and `minES` over `minLife`.

After running it:

- Compare before/after stats.
- Call out removed notables, keystones, jewel sockets, and travel changes.
- Do not present the optimizer result as final without a Lua recalculation.

## Alternate Tree Caution

For tree versions ending in `_alternate`:

- Do not trust static passive point legality checks as final.
- Prefer Lua/PoB tree metadata and official tree links.
- Display alternate ascendancy names from Lua or build XML, not standard-tree ID mappings.
- If static analysis reports over-budget passives, describe it as an unreliable static estimate unless PoB itself reports invalid allocation.
