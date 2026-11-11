# Tree Optimization Workflows

Use this reference when the user asks where to spend passives, how to path to nodes, or whether a tree edit is worth making.

Use the advertised snapshot tools and check their schemas. If a requested
capability is unavailable, report that limitation.

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
   For up to five explicit targets, `foundation_derive_tree_paths` recalculates
   PoB's path after each allocation and publishes one child only if all targets
   succeed. Mastery targets require the matching `mastery_effects` entry. It
   does not remove nodes or establish available points or legality.
   For removal, `foundation_trial_tree_removal` returns a seven-day trial and
   every node PoB removed as dependent on the requested node. Review the full
   list and compare resulting stats before retaining or saving that child. A
   missing name remains unknown; point refunds and game legality are not proven.
6. Retain a chosen trial using `foundation_retain_snapshot` or save it with
   `foundation_save_file` only when the user wants the result kept. Seven-day
   trials can expire; neither deriving nor retaining edits an existing file.

Do not claim that broad reallocation or globally optimal trees are implemented
merely because bounded nearby ranking is available. If the requested capability
is absent from the advertised tools, explain that limitation.

For `_alternate` tree versions, use PoB's tree and ascendancy observations;
static passive-point counts and ordinary ascendancy ID mappings can be wrong.
Do not infer that an allocation is legal solely from a static point estimate.

Snapshot tree queries run a new PoB engine against the local image or checkout;
they do not fetch current tree data from the internet. The source fingerprint
covers all PoB source files, not just one tree version. After a source update,
an older snapshot can fail with an identity mismatch even if its tree version
was unchanged. Export its XML and explicitly import it under the updated engine
to create a new root snapshot; inspect the new tree and recalculated values.
Do not claim an image or checkout is current without checking its provenance.
