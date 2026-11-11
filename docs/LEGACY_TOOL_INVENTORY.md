# Legacy tool inventory

Generated from registered schema groups in the current build. Most entries are pending migration; individual status below records partial exposure without claiming final acceptance. Skill references below are exact-name matches in packaged skill Markdown only; clients, aliases, scripts and dynamic references still require assessment. Group names indicate current source, not final module ownership. Capability-gated tools are included.

## getBuildGoalsToolSchemas

- `get_build_issues` — target: analysis and optimization; replacement: `check_snapshot_issues`; status: partially migrated (legacy callers remain; full validation is separate); skill references: no exact name found in packaged skill Markdown.
- `get_passive_upgrades` — target: analysis and optimization; replacement: `submit_snapshot_passive_ranking` and `summarize_snapshot_passive_ranking` with explicit metrics and bounded nearby paths; status: partially migrated (legacy callers remain; discovery and metric selection differ from legacy heuristics); skill references: no exact name found in packaged skill Markdown.
- `suggest_masteries` — target: analysis and optimization; replacement: `discover_snapshot_mastery_effects`, `rank_snapshot_mastery_effects` and durable all-node `submit_snapshot_mastery_ranking` / `summarize_snapshot_mastery_ranking`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `find_best_anointment` — target: analysis and optimization; replacement: `rank_snapshot_anointments` using PoB's isolated native simulation and explicit damage metric; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `analyze_build_cluster_jewels` — target: analysis and optimization; replacement: `inspect_snapshot_cluster_jewels`; status: partially migrated (native allocations exposed; heuristic synergy and legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `analyze_cluster_jewels` — target: analysis and optimization; replacement: `inspect_local_cluster_jewels` without PoB, or explicit file import plus `inspect_snapshot_cluster_jewels`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `suggest_watchers_eye` — target: analysis and optimization; replacement: `inspect_snapshot_watchers_eye` matches versioned PoB data to saved skill-gem states; status: partially migrated (ranked recommendations and legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `check_boss_readiness` — target: analysis and optimization; replacement: `assess_snapshot_boss_reference`; status: partially migrated (legacy callers remain; thresholds are unverified heuristics, not readiness guarantees); skill references: no exact name found in packaged skill Markdown.
- `suggest_crafting` — target: crafting and item data; replacement: `prepare_crafting_context` and independent `reference_currency_rates`; status: partially migrated (legacy callers remain; page title is not a crafting rule); skill references: `skills/pob-crafting/SKILL.md`.

## getConfigToolSchemas

- `get_config` — target: calculation and configuration; replacement: snapshot evaluation or typed configuration change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `set_config` — target: calculation and configuration; replacement: snapshot evaluation or typed configuration change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `set_enemy_stats` — target: calculation and configuration; replacement: `derive_snapshot_enemy_config` with verified inputs and optional separate damage comparison; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `save_config_preset` — target: calculation and configuration; replacement: `save_snapshot_config_preset` in a versioned store; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `load_config_preset` — target: calculation and configuration; replacement: `apply_snapshot_config_preset` creating a verified child; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `list_config_presets` — target: calculation and configuration; replacement: `list_local_config_presets` and `read_local_config_preset`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.

## getExportToolSchemas

- `export_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `save_tree` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `snapshot_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `list_snapshots` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `restore_snapshot` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `export_build_summary` — target: analysis and optimization; replacement: `summarize_snapshot_build` with explicit metrics and optional item text; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.

## getLuaToolSchemas

- `inspect_item_affix_weight` — target: crafting and item data; replacement: `inspect_pob_item_affix_weight` uses a shared-limiter disposable engine without a snapshot; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `compare_equipment_candidate` — target: analysis and optimization; replacement: `foundation_preview_item`; status: snapshot preview live-tested, legacy callers require migration; skill references: `references/trade-tools.md`.
- `lua_get_capabilities` — target: engine lifecycle and introspection; replacement: `inspect_pob_engine`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `lua_get_build_snapshot` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `lua_start` — target: engine lifecycle and introspection; replacement: internal disposable engine executor; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `lua_stop` — target: engine lifecycle and introspection; replacement: executor cleanup and service shutdown; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `lua_new_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `lua_save_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `lua_load_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `lua_import_code` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `list_specs` — target: tree and versioned data; replacement: `foundation_specs`; status: snapshot spec catalog implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `select_spec` — target: tree and versioned data; replacement: `foundation_derive_spec`; status: selection and all-spec reload checks implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `create_spec` — target: tree and versioned data; replacement: `foundation_create_spec`; status: snapshot creation and copy implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `delete_spec` — target: tree and versioned data; replacement: `foundation_delete_spec`; status: snapshot deletion implemented with explicit active replacement, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `rename_spec` — target: tree and versioned data; replacement: `foundation_rename_spec`; status: snapshot rename implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `list_item_sets` — target: equipment and gems; replacement: `foundation_item_sets`; status: snapshot catalog implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `select_item_set` — target: equipment and gems; replacement: `foundation_derive_item_set`; status: selection with all-set reload verification implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `set_character_level` — target: calculation and configuration; replacement: snapshot evaluation or typed configuration change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `lua_get_ailments` — target: calculation and configuration; replacement: `inspect_snapshot_ailments`; status: partially migrated (legacy callers remain; estimates are withheld when calculation and main selections differ); skill references: no exact name found in packaged skill Markdown.
- `lua_get_stats` — target: calculation and configuration; replacement: snapshot evaluation or typed configuration change; status: not migrated; skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `lua_get_tree` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `references/troubleshooting.md`, `skills/pob-docker-mcp/SKILL.md`.
- `lua_set_tree` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `update_tree_delta` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `lua_get_build_info` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: `references/tool-workflows.md`, `skills/pob-docker-mcp/SKILL.md`.
- `lua_reload_build` — target: build lifecycle / snapshot; replacement: snapshot import/read/list/export or typed derived version; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `search_tree_nodes` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `add_item` — target: equipment and gems; replacement: snapshot equipment/gem query or typed isolated change; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `get_equipped_items` — target: equipment and gems; replacement: snapshot equipment/gem query or typed isolated change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `toggle_flask` — target: equipment and gems; replacement: `foundation_derive_flask_active`; status: snapshot activation and immediate calculation fix implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `get_skill_setup` — target: equipment and gems; replacement: snapshot equipment/gem query or typed isolated change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `set_main_skill` — target: equipment and gems; replacement: `foundation_derive_selection`; status: persistent selection implemented, legacy callers require migration; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `create_socket_group` — target: equipment and gems; replacement: `foundation_derive_skill_group`; status: group creation implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `add_gem` — target: equipment and gems; replacement: `foundation_derive_gem_list`; status: single gem insertion implemented, legacy callers require migration; skill references: `skills/pob-docker-mcp/SKILL.md`.
- `set_gem_level` — target: equipment and gems; replacement: `foundation_derive_gem`; status: implemented for existing gems, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `set_gem_quality` — target: equipment and gems; replacement: `foundation_derive_gem`; status: quality implemented preserving existing type, changing quality type and legacy callers remain pending; skill references: no exact name found in packaged skill Markdown.
- `remove_skill` — target: equipment and gems; replacement: `foundation_remove_skill_group`; status: removal implemented with explicit replacements and independent calculation selection preservation, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `remove_gem` — target: equipment and gems; replacement: `foundation_derive_gem_list`; status: single gem removal implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `toggle_socket_group` — target: equipment and gems; replacement: `foundation_derive_skill_group_enabled`; status: explicit enable/disable implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `toggle_gem` — target: equipment and gems; replacement: `foundation_derive_gem`; status: explicit enabled state implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `setup_skill_with_gems` — target: equipment and gems; replacement: `foundation_derive_skill_group`; status: atomic creation implemented, legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `add_multiple_items` — target: equipment and gems; replacement: snapshot equipment/gem query or typed isolated change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `plan_leveling` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `find_item_upgrades` — target: market and workflows; replacement: market data service or cross-domain workflow; status: not migrated; skill references: `references/trade-tools.md`.

## getOptimizationToolSchemas

- `analyze_defenses` — target: analysis and optimization; replacement: `inspect_snapshot_defenses` and `check_snapshot_issues`; status: partially migrated (legacy heuristic scoring and callers remain); skill references: no exact name found in packaged skill Markdown.
- `suggest_optimal_nodes` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `optimize_tree` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `analyze_items` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `optimize_skill_links` — target: analysis and optimization; replacement: `inspect_snapshot_skill_groups` and explicit support comparisons; status: partially migrated (legacy callers remain; no global optimizer implied); skill references: no exact name found in packaged skill Markdown.
- `create_budget_build` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: no exact name found in packaged skill Markdown.

## getPoeNinjaToolSchemas

- `get_currency_rates` — target: market and workflows; replacement: `reference_currency_rates`; status: independent source workflow live-tested, other legacy callers require migration; skill references: no exact name found in packaged skill Markdown.
- `find_arbitrage` — target: market and workflows; replacement: `screen_currency_spreads`; status: bounded theoretical screening live-tested, instant-buyout verification and other legacy callers remain pending; skill references: no exact name found in packaged skill Markdown.
- `calculate_trading_profit` — target: market and workflows; replacement: `simulate_reference_currency_chain`; status: reference-only workflow live-tested, executable profit and other legacy callers remain pending; skill references: no exact name found in packaged skill Markdown.
- `find_timeless_jewel_seeds` — target: timeless jewels; replacement: `search_snapshot_timeless_seeds`, independent snapshot-based feature; status: partially migrated (Elegant Hubris notable seeds and Caspiro fixed keystone only; further independent native transformation comparison remains); skill references: no exact name found in packaged skill Markdown.

## getSkillGemToolSchemas

- `analyze_skill_links` — target: analysis and optimization; replacement: `inspect_snapshot_skill_groups`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `suggest_support_gems` — target: analysis and optimization; replacement: `foundation_compatible_supports`; status: partially migrated (legacy callers remain; compatible does not imply better); skill references: no exact name found in packaged skill Markdown.
- `compare_gem_setups` — target: analysis and optimization; replacement: `submit_snapshot_gem_setups` and `summarize_snapshot_gem_setups`, backed by `foundation_derive_gem_setup` and `compare_snapshot_gem_setups`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `rank_support_gems` — target: analysis and optimization; replacement: `foundation_replace_support` and `rank_snapshot_supports`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `validate_gem_quality` — target: analysis and optimization; replacement: `inspect_snapshot_skill_groups` with `all_groups`; status: partially migrated (legacy callers remain; no quality benefit or corruption inferred); skill references: no exact name found in packaged skill Markdown.
- `find_optimal_links` — target: analysis and optimization; replacement: `inspect_snapshot_skill_groups` plus explicit candidate comparisons; status: partially migrated (legacy callers remain; no optimality claim); skill references: no exact name found in packaged skill Markdown.
- `gem_upgrade_path` — target: analysis and optimization; replacement: `inspect_snapshot_skill_groups` plus explicit comparisons; status: partially migrated (legacy callers remain; prices and upgrade priorities remain unknown); skill references: no exact name found in packaged skill Markdown.

## getToolSchemas

- `analyze_build` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: `references/tool-workflows.md`, `skills/pob-docker-mcp/SKILL.md`.
- `compare_builds` — target: analysis and optimization; replacement: `compare_snapshot_builds` with explicit snapshot IDs and saved calculation contexts; status: partially migrated (snapshot skill workflow documented; legacy file-name callers remain); skill references: `skills/pob-docker-mcp/SKILL.md`.
- `list_builds` — target: build lifecycle / snapshot; replacement: `list_local_build_files` plus `foundation_import_file`; status: partially migrated (legacy callers remain); skill references: `references/tool-workflows.md`, `references/troubleshooting.md`, `skills/pob-docker-mcp/SKILL.md`.
- `get_build_stats` — target: calculation and configuration; replacement: snapshot evaluation or typed configuration change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `start_watching` — target: file observation; replacement: `start_local_build_watch`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `stop_watching` — target: file observation; replacement: `stop_local_build_watch`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `get_recent_changes` — target: file observation; replacement: `list_local_build_changes`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `watch_status` — target: file observation; replacement: `get_local_build_watch`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `refresh_tree_data` — target: tree and versioned data; replacement: versioned tree query or typed tree/spec change; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `compare_trees` — target: tree and versioned data; replacement: `compare_snapshot_trees`; status: snapshot comparison implemented, legacy file callers require migration; skill references: no exact name found in packaged skill Markdown.
- `get_nearby_nodes` — target: tree and versioned data; replacement: `find_snapshot_nearby_nodes`; status: partially migrated (legacy callers and skills remain); skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `find_path_to_node` — target: tree and versioned data; replacement: `find_snapshot_tree_path`; status: partially migrated (legacy callers and skills remain); skill references: `references/tool-workflows.md`, `references/tree-optimization.md`, `skills/pob-docker-mcp/SKILL.md`.
- `get_build_notes` — target: build lifecycle / snapshot; replacement: `foundation_read_notes`; status: partially migrated (snapshot skill workflow documented; legacy file-name callers remain); skill references: `skills/pob-docker-mcp/SKILL.md`.
- `set_build_notes` — target: build lifecycle / snapshot; replacement: `foundation_derive_notes` and explicit file save; status: partially migrated (snapshot skill workflow documented; legacy file-name callers remain); skill references: `skills/pob-docker-mcp/SKILL.md`.
- `classify_item_affixes` — target: crafting and item data; replacement: `classify_modifier_lines` backed by independent PoB modifier data; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `list_craftable_mods` — target: crafting and item data; replacement: `query_bench_modifiers`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.
- `find_affix_tiers` — target: crafting and item data; replacement: `query_modifier_tiers`; status: partially migrated (legacy callers remain); skill references: no exact name found in packaged skill Markdown.

## getTradeToolSchemas

- `compare_trade_listings_in_pob` — target: market and workflows; replacement: `preview_trade_listings`; status: bounded batch preview implemented, legacy callers require migration; skill references: `references/trade-tools.md`.
- `compare_trade_listing_in_pob` — target: market and workflows; replacement: `preview_trade_listings`; status: snapshot and official source preview live-tested, legacy callers require migration; skill references: `references/trade-tools.md`.
- `find_weighted_trade_items` — target: market and workflows; replacement: market data service or cross-domain workflow; status: not migrated; skill references: no exact name found in packaged skill Markdown.
- `search_trade_items` — target: market and workflows; replacement: `search_official_trade`; status: new source tool live-tested, legacy aliases and callers require migration; skill references: `references/trade-tools.md`.
- `get_item_price` — target: market and workflows; replacement: `sample_trade_item_price`; status: new source workflow implemented; legacy callers require migration; skill references: `references/trade-tools.md`.
- `get_leagues` — target: market and workflows; replacement: `list_trade_leagues`; status: new source tool live-tested, caller migration and legacy removal pending; skill references: `references/trade-tools.md`.
- `search_stats` — target: market and workflows; replacement: `search_trade_stats` for official metadata; status: new source tool live-tested, static fallback and callers require separate migration; skill references: `references/trade-tools.md`, `skills/pob-docker-mcp/SKILL.md`.
- `compare_trade_items` — target: market and workflows; replacement: `compare_official_trade_listings` and optional `preview_trade_listings`; status: partially migrated (legacy callers and skills remain); skill references: `references/trade-tools.md`.
- `find_resistance_gear` — target: market and workflows; replacement: `search_resistance_listings`; status: source-backed search live-tested, legacy callers require migration; skill references: `references/trade-tools.md`.
- `search_cluster_jewels` — target: market and workflows; replacement: `search_cluster_listings`; status: source-backed bounded search live-tested, legacy aliases and callers require migration; skill references: no exact name found in packaged skill Markdown.
- `generate_shopping_list` — target: market and workflows; replacement: `list_snapshot_equipment` with optional reference prices and separate securable Trade search; status: partially migrated (legacy file-name callers and skills remain); skill references: `references/trade-tools.md`.

## getValidationToolSchemas

- `validate_build` — target: analysis and optimization; replacement: analysis workflow using snapshot and explicit metrics; status: not migrated; skill references: `skills/pob-docker-mcp/SKILL.md`.

## buildCostSchemas

- `estimate_build_cost` — target: market and workflows; replacement: `estimate_snapshot_cost` over snapshot and independent economy source; status: new tool implemented and live-tested, other legacy caller migration and old route removal pending; skill references: no exact name found in packaged skill Markdown.

## comparableToolSchemas

- `estimate_comparable_item` — target: market and workflows; replacement: `estimate_trade_comparable`; status: new source tool live-tested and policy extracted, other caller migration and legacy route removal pending; skill references: no exact name found in packaged skill Markdown.

## featureRegistry

- `compare_craft_budget` — target: crafting and item data; replacement: item data/crafting module; status: exposed through new registry, final caller and removal audit pending; skill references: `skills/pob-economy/SKILL.md`, `skills/pob-crafting/SKILL.md`.
- `simulate_simple_annul` — target: crafting and item data; replacement: item data/crafting module; status: exposed through new registry, final caller and removal audit pending; skill references: `skills/pob-crafting/SKILL.md`.


## Replacement and acceptance contracts by target

These are migration targets, not claims that a replacement is complete. Every
row above inherits the corresponding contract below; each tool additionally
requires its own parity fixture, exact caller/skill mapping and evidence before
removal from compatibility mode.

| Target | Replacement and required evidence |
| --- | --- |
| build lifecycle / snapshot | Import, read, list and export through snapshot IDs; prove share-code/XML equivalence, parent linkage, explicit overwrite and restart persistence. Legacy named files and notes need separate migration semantics; the existing `foundation_*` tools cover only part of this group. |
| engine lifecycle and introspection | Hide process start/stop inside the engine executor; provide a read-only capability/version report. Test unavailable engine, concurrent startup, crash, timeout and mismatched identity. Do not reproduce mutable session lifecycle in the new API. |
| calculation and configuration | Use `foundation_evaluate` for read-only stats and isolated selection/config overrides; persistent changes require a typed derived snapshot. Validate player/minion metrics, explicit unknowns, rejected options and unchanged baseline against real PoB. Configuration presets and ailments require their own contracts. |
| tree and versioned data | Read/query the tree with its actual tree/data version; express mutations as typed derived snapshots. Test legacy/event tree versions, ascendancy names, masteries, allocation and export/reload against the engine. Existing `foundation_derive_level` is not a tree replacement. |
| equipment and gems | Read the corresponding snapshot state; apply validated typed item/gem/skill changes in an isolated engine. Compare actual equipped state, enabled flags, socket groups and selected effects after reload; reject partial publication. Single-slot item changes are implemented with restrictions; gem mutations are not. |
| analysis and optimization | Preserve each workflow as a feature over explicit snapshots and metrics, with candidate scope and partial failures. Real-engine comparisons must prove baseline isolation and player/minion metric correctness. Do not equate heuristic recommendations with a verified optimum. |
| market and workflows | Move official trade, ninja and composition behind separate adapters; preserve exact league, `securable` and priced conditions, source coverage, timestamps and original currencies. For PoB comparisons test each listing against the same captured snapshot, including partial failure. |
| crafting and item data | Keep versioned item/affix data and crafting mechanics separate. Test source classifications, zero versus unknown weight, item state and probability provenance. Mathematical budget results cannot become asserted crafting odds without independently verified rules. |
| timeless jewels | Independent feature using PoB versioned tree and jewel data, not a dependency of ordinary calculations. Compare actual seed/node transformations against PoB with version-specific fixtures. |
| file observation | Optional local file adapter that creates explicit imports or notifications; it must not silently mutate an existing snapshot. Test file replacement, duplicate events and shutdown. |

Known partial associations: `lua_import_code` maps to
`foundation_import_code`; `lua_load_build` requires an explicit XML import;
`lua_get_stats` maps partially to `foundation_evaluate`; `set_character_level`
maps to `foundation_derive_level`; `export_build` and `list_snapshots` map
partially to `foundation_export_build` and `foundation_list_snapshots`. These
interfaces differ in state and arguments, so each affected client and skill
still needs migration and regression tests. No other old tool is deemed replaced
solely by its category label. Detailed mappings and acceptance cases are being
developed in [LEGACY_MIGRATION_CONTRACTS.md](LEGACY_MIGRATION_CONTRACTS.md).
