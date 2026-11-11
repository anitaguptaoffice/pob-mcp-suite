# Path of Building MCP Server

MCP server for Path of Building (PoE 1). It exposes PoB's own calculation
engine over stdio and stores every build state as an immutable snapshot, so a
result can be traced back to the exact XML, engine identity and configuration
that produced it.

Chinese-language entry point and repository build instructions live in the
[root README](../../README.md). This file is the English reference for tools,
configuration and development.

## Design

- **One service surface.** Every tool is registered by the same feature
  registry and every registration is checked for a unique name at startup.
- **Immutable snapshots.** Builds are content-addressed JSON records. Every
  mutation creates a verified child snapshot; nothing edits a parent in place.
  Trial snapshots expire after seven days unless retained.
- **Isolated engine processes.** Calculations run in a separate headless PoB
  process started from an unmodified engine checkout. A failing or hanging
  evaluation cannot corrupt the snapshot store.
- **Explicit evidence.** Results carry the engine identity, requested metrics
  and warnings. Missing values stay `unknown` instead of becoming zero, and
  reference prices are labelled as reference data, never executable profit.
- **Durable jobs.** Long rankings (gem setups, masteries, passives, jewels)
  run as resumable local jobs and report partial failures.

The engine is driven through `lua/vanilla_stdio_bridge.lua`. PoB source is not
patched; `#@` directive lines are stripped when the adapter loads the vendor
files.

## Requirements

- Node.js 20 or later
- A LuaJIT interpreter able to parse your PoB revision (`POB_CMD`)
- A Path of Building `src/` checkout, or the vendored engine at
  `vendor/PathOfBuilding/src` when running from a full checkout of this
  repository

Both dependencies are mandatory. Startup resolves the engine checkout and
opens one engine instance to verify the interpreter, bridge and PoB data; the
server exits with an error when either LuaJIT or PoB is missing.

## Install

```bash
git clone https://github.com/anitaguptaoffice/pob-mcp-suite.git
cd pob-mcp-suite
npm --prefix packages/pob-mcp ci
npm --prefix packages/pob-mcp run build
```

Or build the container image from the repository root:

```bash
docker build -t pob-mcp-suite:local .
```

## Configuration

Register the server in your MCP client. The command is the same in every
client; only the configuration file differs.

```json
{
  "mcpServers": {
    "pob": {
      "command": "node",
      "args": ["/absolute/path/to/pob-mcp-suite/packages/pob-mcp/build/index.js"],
      "env": {
        "POB_DIRECTORY": "/path/to/Path of Building/Builds",
        "POB_CMD": "/absolute/path/to/luajit"
      }
    }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `POB_DIRECTORY` | detected Builds directory | Directory of `.xml` builds used for import, file catalog and save targets |
| `POB_SNAPSHOT_DIRECTORY` | `<POB_DIRECTORY>/.pob-snapshots` | Snapshot store, history catalog and durable job state |
| `POB_CMD` | `luajit` | LuaJIT executable; resolved through `PATH` unless absolute |
| `POB_PATH` | detected PoB app, else vendored `vendor/PathOfBuilding/src` | Path to a PoB `src/` checkout; required, and the server verifies the engine at startup |
| `POB_ADAPTER_PATH` | `<repo>/lua/vanilla_stdio_bridge.lua` | Bridge entry file loaded into the engine |
| `POB_TIMEOUT_MS` | `30000` | Timeout for one engine request |
| `POB_DEBUG` | `false` | Set `"true"` for bridge stderr logging |
| `POE_TRADE_ENABLED` | `false` | Advertise the official international Trade tools |
| `POE_SESSION_ID` | (none) | `POESESSID` cookie for endpoints that require login |
| `POE_RATE_LIMIT_PER_SECOND` | `4` | Client-side Trade request rate limit |

`POE_TRADE_ENABLED=true` adds twelve tools. Tool discovery means the group is
enabled, not that credentials, network access or the selected league work.

### Choosing the interpreter

The server verifies the interpreter and engine at startup. To check by hand:

```bash
"$POB_CMD" -v
"$POB_CMD" -bl "$POB_PATH/Modules/Main.lua" > /dev/null
```

The second command only compiles the file. `'=' expected near '+'` means the
interpreter cannot parse that PoB revision.

A standalone checkout may also need Lua modules such as `lua-utf8`:

```bash
luarocks --lua-version=5.1 --lua-dir=/path/to/luajit-prefix --local install luautf8
```

The bridge searches the checkout's `runtime/` directory and
`~/.luarocks/lib/lua/5.1`. Follow any missing-module diagnostic for additional
dependencies.

### Snapshots and retention

- `foundation_import_*`, `foundation_create_build` and every `derive_*`,
  `replace_*` or `transplant_*` operation produce a snapshot.
- Mutating tools create a durable child unless `trial: true` is passed.
  Ranking and comparison candidates always use seven-day trial snapshots so a
  large evaluation does not fill the store with permanent children.
- `foundation_retain_snapshot` makes a snapshot permanent; saving a build file
  also retains it and its ancestors.
- Expired trials are removed on a later server start, never while a job is
  using them.
- Snapshots are shared by every tool: each calculation loads the snapshot named
  in the request, so results always describe one recorded build state.

## Tool reference

120 tools are advertised with the default configuration; 132 with
`POE_TRADE_ENABLED=true`. Names are stable identifiers; descriptions below are
summaries, and each tool's schema is authoritative.

### Foundation — build and snapshot lifecycle

| Tool | Description |
|---|---|
| `foundation_trial_tree_removal` | Create a seven-day trial removing a passive node and PoB-native dependent nodes; return every removed node. |
| `foundation_derive_tree_paths` | Allocate 1–5 target nodes in order using PoB native paths in one verified child. |
| `foundation_derive_auto_item` | Ask PoB to auto-equip an item in an empty compatible slot and return the selected slot and a verified child. |
| `foundation_item_inventory` | List PoB item inventory for a snapshot, including unequipped items, with ID pagination. |
| `foundation_derive_inventory_item` | Add an item without auto-equipping and create a verified child. |
| `foundation_replace_tree` | Replace the complete active passive tree in a verified child snapshot. |
| `restore_snapshot_file` | Replace an existing local build file using an explicit snapshot and expected current fingerprint. |
| `foundation_derive_items` | Atomically equip 1–10 explicit items in distinct slots and create a verified snapshot. |
| `foundation_create_build` | Create a new PoB build as a durable immutable snapshot after verifying the requested class, ascendancy and tree version survive reload. |
| `foundation_import_build` | Import a PoB XML document into an immutable snapshot. |
| `foundation_import_file` | Import an XML build from the configured local build directory. |
| `foundation_save_file` | Retain the snapshot and save it to the local build directory; overwrite is false by default. |
| `foundation_import_code` | Import a compressed PoB build share code into an immutable snapshot. |
| `foundation_read_snapshot` | Read snapshot metadata without XML. |
| `foundation_retain_snapshot` | Permanently retain a snapshot and its ancestors without changing its ID. |
| `foundation_snapshot_retention` | Read snapshot trial expiry and explicit retention status. |
| `foundation_list_snapshots` | List snapshot metadata by ID in pages. |
| `foundation_item_affix_weight` | Read PoB modifier spawn weight for an item; not a crafting probability. |
| `foundation_preview_item` | Compare an item against a snapshot in PoB without modifying it; item legality and availability are not verified. |
| `foundation_compatible_supports` | Query PoB support compatibility for the selected skill; not a damage ranking. |
| `foundation_search_tree` | Search nodes in the snapshot tree version; results are bounded and unordered. |
| `foundation_inspect` | Read selected build, tree, item, skill or config sections from a snapshot. |
| `foundation_read_notes` | Read PoB notes from an immutable snapshot. |
| `foundation_derive_notes` | Create a verified snapshot with replaced or appended PoB notes; the source snapshot and any local build file are unchanged. |
| `foundation_evaluate` | Calculate specified PoB metrics for a snapshot. |
| `foundation_mastery_node_options` | Read PoB options for a mastery node, allocated or not; this does not prove allocatability. |
| `foundation_mastery_options` | Read PoB effect options for allocated mastery nodes in a snapshot. |
| `foundation_derive_masteries` | Change effects on already allocated mastery nodes using PoB-valid effect IDs. |
| `foundation_derive_tree` | Create a snapshot with exact passive node additions and removals, including effects for newly added mastery nodes. |
| `foundation_derive_config` | Create a new snapshot with explicit PoB config changes. |
| `foundation_derive_item` | Equip an item in one slot and create a verified snapshot. |
| `foundation_derive_level` | Create a new snapshot with a changed character level. |
| `foundation_derive_selection` | Create a verified snapshot with an explicitly selected main skill group, active skill or skill part. |
| `foundation_derive_gem` | Create a verified child snapshot changing an existing gem level, quality, default quality type and/or enabled state. |
| `foundation_replace_support` | Atomically replace one enabled support in the saved main skill group and create a verified child snapshot. |
| `foundation_derive_gem_setup` | Atomically create a child snapshot with an explicit full main-group gem setup, retaining existing gem instances where possible. |
| `foundation_derive_gem_list` | Add or remove one gem in a verified child snapshot. |
| `foundation_derive_skill_group` | Atomically create a skill group with optional PoB-resolved gems in a verified child snapshot. |
| `foundation_derive_skill_group_enabled` | Enable or disable one skill group in a verified child snapshot. |
| `foundation_remove_skill_group` | Remove a skill group in a verified child snapshot; provide post-removal replacements when removing a selected main or independent calculation group. |
| `foundation_derive_flask_active` | Set the PoB activation state of one flask slot in a verified child snapshot; activation does not establish in-game uptime. |
| `foundation_item_sets` | List the snapshot item sets using PoB IDs and identify the selected set. |
| `foundation_derive_item_set` | Select a PoB item set in a verified child snapshot, checking equipment in every set after reload. |
| `foundation_specs` | List the passive tree specs of a snapshot using PoB indices. |
| `foundation_derive_spec` | Select a passive spec in a verified child snapshot, checking all specs after reload. |
| `foundation_create_spec` | Create or copy a passive spec in a verified child snapshot. |
| `foundation_rename_spec` | Rename a passive spec in a verified child snapshot. |
| `foundation_delete_spec` | Delete a passive spec in a verified child. |
| `foundation_export_build` | Export a snapshot as PoB XML. |
| `foundation_submit_evaluations` | Start a bounded batch of snapshot evaluations. |
| `foundation_get_job` | Read job status and per-item results. |
| `foundation_cancel_job` | Request cancellation; the active item finishes before cancellation is complete. |

### Snapshot analysis and evaluation

All tools in this group read one immutable snapshot (or two explicit
snapshots) inside an isolated engine. Rankings that need many evaluations run
as durable jobs: create the job with `submit_*`, poll with `summarize_*` or
`foundation_get_job`, and cancel with `foundation_cancel_job`.

| Tool | Description |
|---|---|
| `save_snapshot_history` | Permanently retain a snapshot and record its build name, tag and description separately from snapshot content. |
| `list_snapshot_history` | List saved snapshot history, optionally filtering by exact build name and tag. |
| `estimate_snapshot_cost` | Estimate an incomplete poe.ninja reference subtotal for the active equipment and skill setup of one immutable PoB snapshot and explicit international league. |
| `list_snapshot_equipment` | List the snapshot active equipment set and optional poe.ninja reference estimates. |
| `compare_snapshot_trees` | Compare allocated passive nodes and mastery selections on two immutable snapshots with the same known tree version; this does not calculate damage or establish legality. |
| `compare_snapshot_builds` | Calculate and compare explicit snapshot metrics in their saved contexts. |
| `compare_snapshot_gem_setups` | Compare explicit descendant snapshots with changes limited to the saved main skill group. |
| `submit_snapshot_gem_setups` | Start a durable job to derive and compare 2–5 explicit full main-skill gem setups from one snapshot. |
| `summarize_snapshot_gem_setups` | Summarize a gem-setup job, preserving failed and pending setups and rejecting comparisons when baseline or engine identity differs. |
| `rank_snapshot_supports` | Replace one enabled support with explicit candidates in separate seven-day trial snapshots and compare one requested PoB metric. |
| `rank_discovered_snapshot_supports` | Discover a bounded alphabetical set of PoB-compatible supports and rank up to four explicit replacements by one metric; not a global optimizer. |
| `find_snapshot_tree_path` | Query the PoB native path to one passive node on the snapshot tree. |
| `find_snapshot_nearby_nodes` | Find unallocated reachable notables and keystones by PoB native passive-point distance on the snapshot tree. |
| `check_snapshot_issues` | Run explicit heuristic checks against a snapshot using PoB stats, items, skills and its saved configuration. |
| `assess_snapshot_boss_reference` | Compare snapshot stats with rough boss reference thresholds; this does not prove readiness. |
| `rank_snapshot_mastery_effects` | Compare up to four effects for an allocated mastery against one immutable snapshot. |
| `discover_snapshot_mastery_effects` | List and page all PoB effect options for allocated mastery nodes in an immutable snapshot; results are not ranked or verified as allocatable. |
| `submit_snapshot_mastery_ranking` | Start a durable local job to compare all discovered allocated mastery effects against one snapshot and one PoB metric. |
| `summarize_snapshot_mastery_ranking` | Summarize a mastery ranking job, retaining partial failures and ranking only observations with consistent baseline, snapshot, configuration and engine identity. |
| `submit_snapshot_passive_ranking` | Find nearby reachable notable and keystone paths and start isolated PoB evaluations. |
| `summarize_snapshot_passive_ranking` | Read passive ranking job progress, failures and relative gains per point. |
| `rank_snapshot_anointments` | Rank PoB native anointment simulations for one equipped item on an immutable snapshot. |
| `summarize_snapshot_build` | Read one snapshot in one PoB engine and return build, selected skills, tree nodes, equipment, config and requested metrics, preserving missing sections and values. |
| `inspect_snapshot_skill_groups` | Inspect saved PoB skill groups and gem level, quality, enabled state and support application, with structured observations. |
| `derive_snapshot_enemy_config` | Apply explicit enemy level, resistances, armour and evasion to a verified child snapshot; optionally compare separate PoB damage metrics. |
| `save_snapshot_config_preset` | Save all current snapshot config values to a local preset. |
| `apply_snapshot_config_preset` | Apply saved settings in a derived snapshot, preserving automatic enemy level where recorded. |
| `search_snapshot_timeless_seeds` | Search Elegant Hubris seeds using the snapshot tree and PoB native lookup data. |
| `transplant_snapshot_tree` | Copy the active tree from one snapshot into a verified child of another. |
| `compare_snapshot_support_contributions` | Measure explicitly selected applied supports by disabling each in an isolated trial and comparing PoB damage against the unchanged snapshot. |
| `inspect_snapshot_cached_stats` | Read serialized historical PoB PlayerStat and MinionStat values; these are not current calculations. |
| `find_snapshot_passive_suggestions` | Find unallocated notable and keystone candidates by goal keywords on the snapshot tree. |
| `compare_snapshot_gem_upgrades` | Compare 1–3 explicit gem level or quality changes in separate seven-day trial snapshots using saved PoB calculation context. |
| `inspect_snapshot_ailments` | Inspect non-damaging ailments for the saved skill and enemy configuration, distinguishing effects credited by PoB from estimated effects on the configured enemy. |
| `inspect_snapshot_defenses` | Read grouped PoB defensive metrics for an explicit snapshot with saved calculation context; unavailable values remain unknown. |
| `inspect_pob_item_affix_weight` | Read a modifier spawn weight from PoB item data for explicit item text, without a build snapshot; this is not a crafting probability. |
| `inspect_pob_engine` | Start an isolated PoB engine and report its actual version, identity and bridge actions without loading a build. |
| `inspect_snapshot_cluster_jewels` | Inspect cluster jewels socketed in the active snapshot tree and PoB-generated notable allocations; optionally include unverified keyword heuristics. |
| `derive_snapshot_official_tree` | Decode an official PoE 1 passive tree URL or code in binary formats 1–6 and replace the active tree of a snapshot. |
| `inspect_snapshot_watchers_eye` | Find PoB Watcher's Eye modifier candidates matching saved skill-gem names and expose enabled states. |
| `compare_snapshot_jewels` | Equip 1–3 explicit jewel candidates in the same allocated passive socket as isolated seven-day trial snapshots and compare requested PoB metrics. |
| `submit_snapshot_jewels` | Start a durable job to compare 1–10 explicit jewel candidates in an allocated socket. |
| `summarize_snapshot_jewels` | Read jewel job results, errors, interrupted items and any recorded child snapshot IDs. |
| `generate_snapshot_weighted_trade` | Generate a PoB weighted Trade query from an isolated snapshot and explicit metric weights. |
| `evaluate_snapshot_stat_category` | Calculate a bounded offense, defense or combined set of PoB metrics for one snapshot. |
| `analyze_snapshot_equipment` | Inspect the active equipment set and PoB context from one snapshot, with separately labeled unverified heuristic suggestions. |
| `prepare_snapshot_leveling` | Read a snapshot’s class, ascendancy and selected skill and provide separately labeled unverified campaign examples. |

### Local build directory

| Tool | Description |
|---|---|
| `inspect_local_build_file` | Read a local build file fingerprint before an explicit restore; no PoB engine is started. |
| `list_local_build_files` | List XML files in the configured local build directory without importing them. |
| `inspect_local_cluster_jewels` | Inspect cluster jewel assignments in the active spec of a saved local PoB XML file without starting PoB. |
| `inspect_local_cached_stats` | Read serialized historical PoB PlayerStat and MinionStat values; these are not current calculations. |
| `start_local_build_watch` | Start observing local build-file changes without importing or modifying snapshots. |
| `stop_local_build_watch` | Stop local build-file observation; already recorded events remain in this process. |
| `get_local_build_watch` | Read current local build watcher state and process-local event cursor. |
| `list_local_build_changes` | Read bounded, ordered file-change events. |
| `list_local_config_presets` | List saved local PoB MCP configuration presets with collision-safe pagination. |
| `read_local_config_preset` | Read a configuration preset without changing a build. |

### Crafting data

| Tool | Description |
|---|---|
| `compare_craft_budget` | Compare buying with a geometric repeat-attempt crafting cost model. |
| `simulate_simple_annul` | Enumerate the single-use outcomes of an Orb of Annulment on a manually verified ordinary magic or rare PoE 1 item. |
| `prepare_crafting_context` | Gather explicit item and optional snapshot context for crafting research. |
| `classify_modifier_lines` | Classify explicit lines against versioned PoB tables; slot counts require confirmed rarity, complete lines and ordinary capacity. |
| `query_bench_modifiers` | Query PoB bench table candidates by item class, level and optional affix type; does not establish unlocks or crafting legality. |
| `query_modifier_tiers` | Query PoB explicit modifier tiers; broad tags or a caller-confirmed complete tag set are distinct from crafting probability. |

### Market reference data

poe.ninja values are reference prices from a stated league and timestamp.
They are not executable buyouts and do not include fees, availability or
liquidity.

| Tool | Description |
|---|---|
| `reference_currency_rates` | Read poe.ninja currency reference values in Chaos Orbs for the exact international league; these are not buyable trade listings. |
| `simulate_reference_currency_chain` | Convert a currency chain using one poe.ninja reference snapshot. |
| `screen_currency_spreads` | Screen bounded theoretical loops using poe.ninja stash-side aggregate quotes. |
| `search_bundled_stat_mappings` | Search the bundled PoB-name and alias mapping offline. |

### Upstream tree reference

| Tool | Description |
|---|---|
| `inspect_upstream_tree_nodes` | Read explicitly selected serialized nodes from the upstream PoB GitHub tree, separately from local snapshot calculations. |

### Official international Trade (`POE_TRADE_ENABLED=true`)

Every search tool that can produce a price uses the `securable` status and an
explicit priced sale type. Tools that take a bounded sample say so; a missing
price is unknown, never zero.

| Tool | Description |
|---|---|
| `search_snapshot_weighted_trade` | Generate a PoB weighted query and search official international Trade with securable and priced filters. |
| `preview_trade_listings` | Fetch up to five official trade listings and compare each exact clipboard item against an immutable PoB snapshot. |
| `screen_snapshot_budget_candidates` | Search explicit international equipment candidates within a chaos budget using securable priced Trade listings, then preview each candidate in PoB. |
| `assemble_snapshot_budget_bundle` | Search bounded securable priced listings for explicit slots, sum selected explicit chaos buyouts and compare their combined PoB trial. |
| `estimate_trade_comparable` | Compare official international instant-buyout listings using confirmed base and stat groups. |
| `search_official_trade` | Search official international PoE 1 listings. |
| `sample_trade_item_price` | Sample up to ten official securable, priced listings for a confirmed item name and international league; currencies are separate and this is not a complete appraisal. |
| `compare_official_trade_listings` | Compare raw official Trade listings by ID, with source time and missing entries. |
| `search_resistance_listings` | Search individual securable, priced international Trade listings with explicit resistance targets and per-item budget. |
| `search_cluster_listings` | Search securable cluster jewels and locally check enchant text and exact notable names within a bounded sample; the trade link represents the broader query. |
| `search_trade_stats` | Search official Trade stat text and return IDs grouped by identical text and source. |
| `list_trade_leagues` | List leagues from official international Trade metadata. |

## Development

```bash
npm --prefix packages/pob-mcp run build      # clean build/ then tsc
npm --prefix packages/pob-mcp test           # unit + integration suites
npm --prefix packages/pob-mcp run test:smoke # real engine + MCP stdio
```

Engine-dependent smoke suites:

| Command | Checks |
|---|---|
| `test:smoke` | Bridge lifecycle, state truthfulness and MCP stdio round trip |
| `test:smoke:foundation` | End-to-end snapshot, tree, item, gem, job and evaluation flows; parallel runner, `SMOKE_CONCURRENCY` controls jobs |
| `test:smoke:trade` | Live international Trade search, stats and price paths |
| `test:smoke:snapshot-cost` | Reference cost of a snapshot in a stated league |
| `test:smoke:source-comparable` | Official listing comparison with source audit |
| `test:smoke:currency-reference` | poe.ninja currency reference output |
| `test:smoke:trade-preview` | Listing preview in an isolated engine |
| `test:smoke:cluster-trade` | Cluster jewel search against official Trade |
| `test:smoke:upstream-tree` | Upstream passive tree node reader |
| `test:smoke:truthfulness` | Adapter state matches the engine |
| `test:smoke:requirements` | Server refuses to start without PoB or LuaJIT and starts with both |
| `test:smoke:build-info` | Lua build-info smoke without a tree |

The foundation suite runs its scripts in parallel (`SMOKE_CONCURRENCY`, default
`min(4, CPUs)`); rerun a subset with
`node scripts/smoke-suite.mjs foundation <filter> [--jobs=N] [--skip=a,b]`.

`npm run validate` at the repository root runs the build, the full Jest suite,
market metadata validation and shell syntax checks.

## Further documentation

- [Quick start](docs/QUICKSTART.md)
- [Quick reference](docs/QUICK_REFERENCE.md)
- [PoB bridge and engine setup](docs/POB_BRIDGE.md)
- [Tree analysis guide](docs/TREE_ANALYSIS_GUIDE.md)
- [Trade API guide](docs/TRADE_API_QUICKSTART.md)
- [Testing guide](docs/TESTING_GUIDE.md)
- [Status and roadmap](docs/ROADMAP.md)
