# Tree analysis guide

Passive tree work is split into observation, mutation and calculation. A
keyword search never proves a node is good; only a ranking job or an explicit
evaluation does, and both require an immutable snapshot.

## Observe

```json
{ "name": "foundation_search_tree", "arguments": {
  "snapshot_id": "<id>", "query": "life", "node_type": "notable", "limit": 20
} }
```

| Tool | Result |
|---|---|
| `foundation_search_tree` | Bounded search in the snapshot's tree version |
| `find_snapshot_tree_path` | PoB path from the current tree to one node |
| `find_snapshot_nearby_nodes` | Unallocated reachable notables/keystones by point distance |
| `find_snapshot_passive_suggestions` | Keyword matches for a goal, unverified |
| `foundation_specs`, `foundation_mastery_options` | Specs and allocated mastery effects |
| `compare_snapshot_trees` | Allocated nodes and mastery differences between two snapshots |

`compare_snapshot_trees` requires the same known tree version and does not
calculate damage or establish legality.

## Mutate

Every call returns a child snapshot ID; the parent is unchanged.

| Tool | Change | Trial default |
|---|---|---|
| `foundation_derive_tree` | Exact `add_nodes` / `remove_nodes` | durable |
| `foundation_derive_tree_paths` | Allocate 1–5 targets in order | durable |
| `foundation_replace_tree` | Replace the full active tree | durable |
| `foundation_trial_tree_removal` | Remove a node plus PoB dependents | always trial |
| `foundation_derive_masteries` | Change effects on allocated masteries | durable |
| `transplant_snapshot_tree` | Copy the active tree to another snapshot | trial |

Pass `trial: true` for a seven-day child. Node IDs are PoB-internal integers;
do not invent them. A removal that breaks dependent nodes is reported with the
full removal list, not silently guessed.

## Rank nodes with calculations

Keyword search answers "what is nearby"; the ranking job answers "what does PoB
actually gain".

```json
{ "name": "submit_snapshot_passive_ranking", "arguments": {
  "snapshot_id": "<id>",
  "metrics": ["TotalDPS"],
  "max_distance": 4,
  "limit": 25,
  "filter": "notable",
  "excluded_node_ids": [12345]
} }
```

```json
{ "name": "summarize_snapshot_passive_ranking", "arguments": { "job_id": "<job>" } }
```

Rules that affect interpretation:

- Metrics must increase when improving. Multiple metrics are scored separately.
- The score is the sum of relative gains per passive point, so a two-point path
  is not compared as if it were one point.
- Excluded nodes cannot appear anywhere on a submitted path, not only at its
  end.
- `min_life` / `min_energy_shield` apply to calculated candidate values.
- Results keep failures and pending items; do not read a partial job as a
  complete ranking.

Cancel with `foundation_cancel_job`. Polling is safe after a restart because
job state is durable.

## Masteries

```json
{ "name": "discover_snapshot_mastery_effects", "arguments": { "snapshot_id": "<id>" } }
```

Pages all PoB options for allocated masters. Then either:

- `rank_snapshot_mastery_effects` — up to four explicit effect IDs, one metric;
  omitting IDs ranks the current discovery page only;
- `submit_snapshot_mastery_ranking` — durable job over every discovered option.

Every candidate is a trial snapshot. Options are not verified as simultaneously
available, and a missing effect is unknown, not zero.

## Anointments and jewels

| Tool | Scope |
|---|---|
| `rank_snapshot_anointments` | PoB anointment simulations for one equipped item |
| `compare_snapshot_jewels` | 1–3 jewels in the same allocated socket |
| `submit_snapshot_jewels` | Up to ten candidates as a job |
| `inspect_snapshot_cluster_jewels` | Socketed cluster jewels and PoB-known notables |
| `search_cluster_listings` | Cluster listings with enchant and exact notables |

Cluster analysis reads PoB's socketed jewels and generated subgraphs. An
unavailable graph is unknown; it does not mean the jewel has no notable.

## Practical workflow

1. Import the build; keep the root snapshot ID.
2. `check_snapshot_issues` and `inspect_snapshot_defenses` to see what is wrong.
3. `find_snapshot_nearby_nodes` for a shortlist, or a keyword search for a
   specific mechanic.
4. Submit a ranking job with one or two metrics that represent your goal.
5. Re-evaluate the best result in the saved context; compare trees to confirm
   the exact allocation.
6. Retain or export only the child you intend to keep.
