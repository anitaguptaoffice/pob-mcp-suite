# Quick reference

One-page lookup for the current tool surface. Every name here is advertised by
the server; full descriptions and schemas are in the
[tool reference](../README.md#tool-reference).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `POB_DIRECTORY` | detected Builds dir | Local `.xml` files |
| `POB_SNAPSHOT_DIRECTORY` | `<POB_DIRECTORY>/.pob-snapshots` | Snapshot store and jobs |
| `POB_CMD` | `luajit` | Must parse your PoB revision |
| `POB_PATH` | detected app, else `vendor/PathOfBuilding/src` | PoB `src/` directory; verified at startup |
| `POB_ADAPTER_PATH` | `<repo>/lua/vanilla_stdio_bridge.lua` | Bridge entry |
| `POB_TIMEOUT_MS` | `30000` | Per-request timeout |
| `POB_DEBUG` | `false` | Bridge logging |
| `POE_TRADE_ENABLED` | `false` | Adds 12 Trade tools |
| `POE_SESSION_ID` | (none) | `POESESSID` cookie |
| `POE_RATE_LIMIT_PER_SECOND` | `4` | Trade throttle |

## Identity and inspection

| Tool | Returns |
|---|---|
| `foundation_inspect` | Selected build, tree, items, skills or config sections |
| `summarize_snapshot_build` | Build, skills, tree, equipment and requested metrics |
| `inspect_snapshot_cached_stats` | Historical serialized PoB stats (not recalculated) |
| `inspect_snapshot_skill_groups` | Gem levels, quality, enabled state and application |
| `list_snapshot_equipment` | Active equipment set, optional reference prices |
| `foundation_item_sets`, `foundation_specs` | PoB item-set and spec indices |

## Calculation

`foundation_evaluate` is the primitive: pass `snapshot_id`, `fields` and
optionally `selection` and `config`. Higher-level readers:

| Tool | Scope |
|---|---|
| `evaluate_snapshot_stat_category` | Bounded offense / defense / combined metric sets |
| `inspect_snapshot_defenses` | Grouped defensive metrics |
| `inspect_snapshot_ailments` | Non-damaging ailment effects and estimates |
| `check_snapshot_issues` | Heuristic checks with unknown values preserved |
| `assess_snapshot_boss_reference` | Stats against rough boss thresholds |

## Mutation

All mutations create a verified child snapshot. `trial: true` makes it expire
after seven days.

| Tool | Change |
|---|---|
| `foundation_derive_tree` | Exact node additions and removals |
| `foundation_derive_tree_paths` | Allocate up to five target nodes by PoB path |
| `foundation_replace_tree` | Replace the active tree |
| `foundation_trial_tree_removal` | Remove a node and PoB-dependent nodes (trial) |
| `foundation_derive_masteries` | Change allocated mastery effects |
| `foundation_derive_item` | Equip one item in a named slot |
| `foundation_derive_items` | Equip up to ten items atomically |
| `foundation_derive_auto_item` | Let PoB choose an empty compatible slot |
| `foundation_derive_inventory_item` | Add an item without equipping |
| `foundation_derive_gem` | Change level, quality or enabled state |
| `foundation_replace_support` | Replace one support |
| `foundation_derive_gem_setup` | Set a full main-group gem setup |
| `foundation_derive_gem_list` | Add or remove one gem |
| `foundation_derive_skill_group` | Create a skill group |
| `foundation_derive_skill_group_enabled` | Toggle a group |
| `foundation_remove_skill_group` | Remove a group |
| `foundation_derive_selection` | Select main group, active skill or skill part |
| `foundation_derive_config` | Change PoB config values |
| `foundation_derive_level` | Change character level |
| `foundation_derive_flask_active` | Toggle flask activation |
| `foundation_derive_item_set` | Select an item set |
| `foundation_derive_spec` / `foundation_create_spec` / `foundation_rename_spec` / `foundation_delete_spec` | Manage specs |
| `foundation_derive_notes` | Replace or append notes |
| `transplant_snapshot_tree` | Copy a tree between snapshots |

## Ranking and comparison

| Tool | Input |
|---|---|
| `compare_snapshot_trees` | Two snapshots, same known tree version |
| `compare_snapshot_builds` | Two snapshots and explicit metrics |
| `compare_snapshot_gem_setups` | Base plus explicit descendant snapshots |
| `rank_snapshot_supports` | One support replaced by explicit candidates |
| `rank_discovered_snapshot_supports` | Bounded PoB-compatible support discovery |
| `find_snapshot_nearby_nodes` | Reachable notables and keystones by point distance |
| `find_snapshot_tree_path` | PoB path to one node |
| `find_snapshot_passive_suggestions` | Keyword candidates (unverified) |
| `submit_snapshot_passive_ranking` | Calculated per-point ranking job |
| `discover_snapshot_mastery_effects` | Page all allocated mastery options |
| `rank_snapshot_mastery_effects` | Up to four options, one metric |
| `submit_snapshot_mastery_ranking` | All discovered options as a job |
| `rank_snapshot_anointments` | Anointment options for one item |
| `compare_snapshot_gem_upgrades` | One to three level/quality changes |
| `compare_snapshot_support_contributions` | Disable each support in isolation |
| `compare_snapshot_jewels` | One to three jewels in the same socket |
| `submit_snapshot_jewels` | Up to ten jewel candidates as a job |

`submit_*` returns a `job_id`; poll with the matching `summarize_*` or
`foundation_get_job`, and stop with `foundation_cancel_job`.

## Jobs

| Tool | Purpose |
|---|---|
| `foundation_get_job` | Status and per-item results |
| `foundation_cancel_job` | Cooperative cancellation |
| `foundation_submit_evaluations` | Up to 100 explicit evaluations |

## Persistence

| Tool | Effect |
|---|---|
| `foundation_read_snapshot`, `foundation_list_snapshots` | Metadata |
| `foundation_snapshot_retention`, `foundation_retain_snapshot` | Trial vs permanent |
| `foundation_export_build` | PoB XML |
| `foundation_save_file` | Write to the build directory |
| `inspect_local_build_file`, `restore_snapshot_file` | Fingerprint and restore a local file |
| `save_snapshot_history`, `list_snapshot_history` | Named history entries |

## Reference data and trade

| Tool | Data |
|---|---|
| `reference_currency_rates` | poe.ninja currency reference for one league |
| `simulate_reference_currency_chain` | Conversion chain using those rates |
| `screen_currency_spreads` | Spread screen across a bounded currency set |
| `search_bundled_stat_mappings` | Bundled stat text to ID mapping |
| `search_trade_stats` | Official stat IDs grouped by text and source |
| `list_trade_leagues` | Official league list |
| `search_official_trade` | Raw listing search |
| `estimate_trade_comparable` | Instant-buyout comparable statistics |
| `sample_trade_item_price` | Up to ten securable priced listings |
| `preview_trade_listings` | Preview listings in isolated PoB |
| `compare_official_trade_listings` | Compare raw listings by ID |
| `search_resistance_listings`, `search_cluster_listings` | Targeted listing searches |
| `search_snapshot_weighted_trade`, `generate_snapshot_weighted_trade` | PoB weighted queries |
| `screen_snapshot_budget_candidates`, `assemble_snapshot_budget_bundle` | Budget candidate flows |

## Conventions

- League names are exact and international (`Standard`, `Hardcore`, ...).
- A missing metric is `unknown`, never `0`.
- `securable` + explicit priced sale type is required before a price is used.
- Snapshot IDs are SHA-256 hex strings.
- Item text is the official clipboard format (starting with `Rarity:`).
- Slot names come from PoB (`Helmet`, `Body Armour`, `Ring 1`, `Flask 1`, ...).
  Read them from `list_snapshot_equipment` or `foundation_inspect` rather than
  assuming a fixed list; newer trees add slots such as `Ring 3` or `Graft 1`.
