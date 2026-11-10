# Tree Optimization Workflows

Use this reference when the user asks where to spend passives, how to path to nodes, or whether a tree edit is worth making.

If `foundation_import_build` is advertised, use the snapshot workflow below.
The legacy workflow later in this file applies only to a server that advertises
those legacy tools. Do not assume the two APIs share state.

## Snapshot workflow

1. Import the build and retain its snapshot ID, as described in
   `snapshot-workflows.md`. Inspect `tree` and `build` with
   `foundation_inspect`; note the active tree version and ascendancy.
2. Use `foundation_search_tree` to find node IDs by name or text. Search is
   bounded and unordered; it does not establish reachability or damage gain.
3. For a specific node, call `find_snapshot_tree_path` with `snapshot_id` and
   `target_node_id`. Check `status` and `node.status`: a missing, unreachable,
   already allocated, or reachable node has different meaning. Only a reachable
   node provides a nonempty `pathNodes` and positive `pointCost` for allocation.
   For candidate discovery, `find_snapshot_nearby_nodes` accepts `max_distance`,
   `limit`, and `filter`; compare `total` with the returned node count to see
   whether the result was limited. It finds nearby notables and keystones, not
   every possible node or a full tree optimization.
4. To compare nearby candidates, use `submit_snapshot_passive_ranking` with one
   or two explicit PoB `metrics` where higher is better, then poll
   `summarize_snapshot_passive_ranking` with the returned `jobId`. Handle
   `no_candidates` without polling. Inspect partial results, metric status,
   baseline, context and identity warnings. The score sums relative gains per
   point and gives two metrics equal weight; it does not prove global optimality.
   Choose a minion metric for minion damage when appropriate; do not add player,
   minion and full damage values without verifying what they include.
5. For a specific reachable path, use `foundation_derive_tree` with `add_nodes`
   set to the returned `pathNodes` and `trial: true`. The child has its own ID;
   the parent is unchanged. Inspect and evaluate both under the same conditions.
   Check available points and legality separately. Paths do not select mastery
   effects; use the advertised mastery tools when an effect must be chosen.
6. Retain a chosen trial using `foundation_retain_snapshot` or save it with
   `foundation_save_file` only when the user wants the result kept. Seven-day
   trials can expire; neither deriving nor retaining edits an existing file.

Do not claim that broad reallocation or globally optimal trees are implemented
merely because bounded nearby ranking is available. If the requested capability
is absent from the advertised tools, explain that limitation.

## Legacy workflow

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
