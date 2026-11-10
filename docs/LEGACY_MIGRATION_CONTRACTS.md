# Legacy migration contracts

This is a migration design, not a claim that legacy tools have moved. Each row
identifies a proposed replacement or an explicitly missing capability, plus the
minimum behavior-specific parity case. The shared acceptance requirements and
packaged-skill references remain in [LEGACY_TOOL_INVENTORY.md](LEGACY_TOOL_INVENTORY.md).
Callers outside the repository and dynamic tool-name references are not known;
inventory them before removing compatibility. All rows remain pending.

`inspect` means `foundation_inspect`; `evaluate` means `foundation_evaluate`.
Those tools require an explicit immutable snapshot ID rather than an implicitly
loaded mutable build. Existing mappings are partial unless the row says otherwise.
Evidence names below identify existing tests where stated; all other checks are
acceptance work to perform during migration, not claims of completed tests.

## PoB engine and build lifecycle

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `lua_get_capabilities` | Read-only adapter capability/version report; no equivalent tool yet. | Missing or unsupported action remains distinct from engine startup failure. |
| `lua_start` | Internal disposable engine executor; no public mutable session start. | Concurrent operations remain isolated and do not require explicit startup. |
| `lua_stop` | Executor cleanup and service shutdown; no public shared-session stop. | Engine crash/timeout closes the lease without corrupting other operations. |
| `lua_new_build` | New typed build-creation operation is needed. | Valid class and ascendancy round-trip; invalid inputs publish no snapshot, including special ascendancy names. |
| `lua_load_build` | `foundation_import_file` or `foundation_import_build`, followed by `inspect`/`evaluate` if summary is needed. | File and XML yield the expected build; source changes do not mutate imported snapshot. |
| `lua_import_code` | `foundation_import_code`; summary requires `inspect`/`evaluate`. | Real PoB build share code yields same observed state as XML; explicitly determine whether tree-only codes are supported. |
| `lua_save_build` | `foundation_save_file`; caller supplies snapshot and output name. | Atomic write and explicit overwrite preserve a different existing file; distinguish from legacy same-source exception. |
| `lua_reload_build` | Explicit new `foundation_import_file`; existing snapshot remains immutable. | Modify source after first import and verify two independent IDs and states. |
| `lua_get_build_snapshot` | Compose `inspect` and selected `evaluate` fields; summary workflow is missing. | Show selected skill, equipment, node count and calculated values from one snapshot without treating absent values as zero. |
| `lua_get_build_info` | `inspect` with `build`. | Character, special ascendancy and tree version match real PoB for the requested snapshot. |
| `export_build` | Explicit file import, optional notes change and `foundation_save_file`; directory and notes semantics are not fully covered. | Source unchanged, requested destination and overwrite honored, notes behavior verified. |
| `snapshot_build` | Durable snapshot import/derive plus separate tag/description metadata; tags and stats metadata are missing. | Existing named-build history and its tags survive migration without being treated as trial data. |
| `list_snapshots` | `foundation_list_snapshots`; build-name and tag filtering and legacy stats metadata are missing. | Pagination does not omit entries; verify filtering once implemented and distinguish old history. |
| `restore_snapshot` | Use a selected immutable snapshot ID; explicit file overwrite and backup are separate operations. | Selecting old state does not mutate later snapshot; file restoration honors backup and overwrite. |
| `export_build_summary` | Presentation workflow over `inspect` and `evaluate`; no equivalent report yet. | Missing values remain unknown; user-facing report includes selected skill and source identity. |
| `list_builds` | Local file catalog; snapshot list alone is not equivalent. | Only configured build directory is listed, with stable behavior for missing directory and nested files. |
| `get_build_notes` | Snapshot notes query is needed. | Notes including Unicode and newlines match source XML. |
| `set_build_notes` | Typed notes-derived snapshot plus explicit file save is needed. | Parent remains unchanged and notes survive reload; no silent file overwrite. |

## Configuration and calculations

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `get_config` | `inspect` with `config`. | Charges, enemy and condition inputs match real PoB including absent values. |
| `set_config` | `foundation_derive_config` for durable change, or isolated `evaluate.config` for one calculation. | Rejected or unapplied keys publish nothing; parent and unrelated settings remain unchanged. |
| `set_enemy_stats` | Translate each explicit enemy input to supported PoB config keys; no dedicated mapping yet. | Each requested resistance, level and defense takes effect; unsupported keys fail explicitly. |
| `save_config_preset` | Separate named preset store is needed. | All settings persist across restart without modifying snapshots. |
| `load_config_preset` | Apply explicit preset through a typed config change; preset store missing. | Reject partial application and preserve baseline on invalid values. |
| `list_config_presets` | Read-only preset catalog is needed. | Empty and persisted catalogs are distinguished from storage errors. |
| `set_character_level` | `foundation_derive_level`. | Verify actual requested level, parent isolation and reloaded state; automatic-level behavior remains explicit. |
| `lua_get_stats` | `evaluate` with explicit fields; legacy category-to-fields mapping is needed. | Compare player, minion and full DPS separately against PoB; missing metrics remain unknown. |
| `get_build_stats` | Explicit file import and `evaluate` with field mapping. | File version and selected metrics come from the same snapshot, with unknowns explicit. |
| `lua_get_ailments` | Dedicated snapshot-bound ailment calculation/report is needed. | Distinguish credited from inflicted magnitude under the selected enemy configuration. |
| `set_main_skill` | `evaluate.selection` only covers temporary selection; a persistent typed selection change is missing. | Validate group, active skill and part separately; persisted choice and damage survive reload. |

## Tree, equipment and skills

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `lua_get_tree` | `inspect` with `tree`. | Selected tree version, allocated IDs, mastery and special ascendancy match PoB. |
| `lua_set_tree` | Calculate exact node delta then `foundation_derive_tree`; class/ascendancy replacement remains missing. | Reject dropped nodes and unconfirmed class/mastery changes without publishing. |
| `update_tree_delta` | `foundation_derive_tree` for exact nodes; legacy automatic path completion is not supplied. | Test disconnected request, explicit path, removals and mastery against actual PoB. |
| `search_tree_nodes` | `foundation_search_tree`; bounded unordered results have different limits/defaults. | Verify tree version, filter, allocated flag and truncation disclosure. |
| `save_tree` | Typed tree derivation and explicit file save; backup and tree-only replacement need dedicated handling. | Other source-file sections remain intact and backup semantics are explicit. |
| `list_specs` | Versioned tree-spec listing is needed. | All named specs and active selection survive reload. |
| `select_spec` | Typed spec selection is needed. | Recalculated snapshot selects the requested spec and preserves other specs. |
| `create_spec` | Typed spec creation/copy is needed. | Copy source and activation flag are honored, with no partial publication on failure. |
| `delete_spec` | Typed spec deletion is needed. | Invalid and active-spec cases are explicit; other specs and parent survive. |
| `rename_spec` | Typed spec rename is needed. | Name survives reload and no unrelated spec changes. |
| `list_item_sets` | Snapshot item-set listing is needed. | List active and alternate item sets using PoB's IDs. |
| `select_item_set` | Typed item-set selection is needed. | The selected set and resulting stats survive reload; other sets and parent remain intact. |
| `add_item` | `foundation_derive_item` only covers a specified slot; no auto-slot or inventory-only equivalent. | Check exact slot, other slots, item raw text, reload and incompatible item; test auto/inventory behavior separately. `foundation-item.mjs` covers a ring fixture. |
| `get_equipped_items` | `inspect` with `items`; empty and hidden slots have different representation. | Preserve each occupied item's raw modifiers and distinguish hidden from empty slots. |
| `toggle_flask` | Typed flask-activation change is needed. | Active flag, recalculated effects and reload match PoB for the requested flask. |
| `get_skill_setup` | `inspect` with `skills`; caller must select main-only view explicitly. | Compare all groups, selected group, enabled gems and quality against PoB. |
| `create_socket_group` | Typed skill-group creation is needed. | Verify slot, label, enabled and full-DPS flags after reload without asserting socket legality. |
| `add_gem` | Typed gem addition is needed. | Validate resolved gem, requested level, quality and enabled flag, then reload; do not assert in-game availability. |
| `set_gem_level` | Typed gem-level change is needed. | Correct group/index changes and other gems remain unchanged after reload. |
| `set_gem_quality` | Typed gem-quality change is needed. | Quality and supported quality type are preserved; unsupported types fail explicitly. |
| `remove_skill` | Typed group removal is needed. | Correct group removed, remaining groups and selected skill handled explicitly. |
| `remove_gem` | Typed gem removal is needed. | Correct indexed gem removed and remaining gems survive reload. |
| `toggle_socket_group` | Typed group-enable change is needed. | Enabled state and recalculated result match after reload. |
| `toggle_gem` | Typed gem-enable change is needed. | Enabled state and recalculated result match after reload. |
| `setup_skill_with_gems` | Atomic typed group-plus-gems change is needed; legacy tool reports partial progress. | Invalid later gem publishes no child; success preserves requested order and flags. |
| `add_multiple_items` | Atomic multi-item changeset is needed; legacy tool can partially apply. | Any incompatible item publishes no child and leaves parent unchanged. |

## Analysis, comparison and tree data

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `get_build_issues` | Snapshot-based issue-scan feature. | Missing resistances and life are unknown; existing threshold behavior is covered. |
| `get_passive_upgrades` | Tree candidate workflow using PoB paths and isolated evaluations. | Rank actual gains per allocated point, expose candidate scope and selected damage metric. |
| `suggest_masteries` | Mastery options plus isolated candidate evaluation and ranking. | Compare effects on the same parent, including minion metric and unavailable effects. |
| `find_best_anointment` | Independent anointment workflow using isolated PoB evaluation. | Amulet and supported belt slots, candidate bounds and baseline remain correct. |
| `analyze_build_cluster_jewels` | Snapshot cluster-jewel analysis feature. | Equipped jewels, allocated notables and heuristic claims match the snapshot. |
| `analyze_cluster_jewels` | Explicit file import and cluster-jewel analysis. | Saved file and current unsaved state remain distinct; no unnecessary engine requirement. |
| `suggest_watchers_eye` | Aura-aware jewel recommendation feature. | Match active auras and label heuristic rather than measured gains. |
| `check_boss_readiness` | Snapshot-based heuristic readiness feature. | Preserve explicit boss difficulty, unknowns and poison-inclusive minion damage. |
| `compare_equipment_candidate` | Snapshot-bound isolated item comparison workflow. | Compare same baseline and player/minion metrics; preserve unsupported-slot and legality limitations. |
| `plan_leveling` | Build-aware leveling-guide feature. | Preserve class, ascendancy and skill inputs; identify unverified advice. |
| `find_item_upgrades` | Equipment context query; no verified upgrade recommendation is currently promised. | Slot and current defense context are accurate; no invented market or gain result. |
| `analyze_defenses` | Snapshot defense analysis feature. | Report missing layers as unknown and handle one-life builds correctly. |
| `suggest_optimal_nodes` | Heuristic node-suggestion feature over versioned tree data. | Do not claim gain, reachability or optimality when not calculated. |
| `optimize_tree` | Versioned nearby-node suggestion feature. | Candidate bounds and lack of recalculated optimum remain explicit. |
| `analyze_items` | Snapshot item-analysis feature. | Report exact active set and distinguish observation from suggested improvements. |
| `optimize_skill_links` | Skill-group inspection feature. | Gem status is preserved without inventing compatibility or damage rankings. |
| `create_budget_build` | Separate budget-build workflow; explicit cost source and assumptions required. | Unknown costs and unsupported substitutions cannot become a complete budget claim. |
| `analyze_skill_links` | Snapshot skill-group inspection. | Match requested group and enabled gems; do not imply compatibility. |
| `suggest_support_gems` | `foundation_compatible_supports` plus presentation. | Preserve exceptional-support filtering, alphabetical order, partial failures and no price/damage ranking. |
| `compare_gem_setups` | Isolated typed gem changes and PoB comparison workflow; mutation capability missing. | Compare each complete candidate against one parent and separate player/minion metrics. |
| `rank_support_gems` | Isolated explicit-candidate support comparison; mutation capability missing. | Only compatible candidates are ranked; requested damage metric and failures are retained. |
| `validate_gem_quality` | Snapshot gem inspection. | Preserve level and quality; do not infer corruption or benefit. |
| `find_optimal_links` | Skill-group inspection; optimizer would be a separate future feature. | Do not claim optimization or budget coverage where unavailable. |
| `gem_upgrade_path` | Enabled-gem inspection feature. | Report unknown cost, damage and corruption odds instead of fabricated advice. |
| `analyze_build` | Snapshot build-analysis workflow. | Extract gear, skills and tree from the requested version; label heuristic conclusions. |
| `compare_builds` | Compare two explicit snapshot IDs. | Keep each build's configuration and data version visible; report incomparable or missing metrics. |
| `refresh_tree_data` | Versioned passive-data adapter refresh is needed. | Invalidate only the requested version and surface failures rather than returning stale data as fresh. |
| `compare_trees` | Snapshot tree-difference feature. | Node and mastery differences use the correct versions and disclose incompatible versions. |
| `get_nearby_nodes` | Snapshot-bound versioned tree-neighborhood query. | Distance, filter and candidate scope match requested tree. |
| `find_path_to_node` | Snapshot-bound PoB path query. | Confirm reachable path and disconnected or unavailable target behavior. |
| `validate_build` | Snapshot validation workflow. | Compare selected configuration, report missing stats and preserve existing regressions. |

## Economy, trade and crafting

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `get_currency_rates` | poe.ninja source adapter and currency-reference query. | Preserve exact international league, original currency, actual fetch time and unknown rates. |
| `find_arbitrage` | Economy workflow over source currency data. | Candidate routes, timestamps and missing conversions remain explicit; no guaranteed profit. |
| `calculate_trading_profit` | Currency-chain calculation over reference quotes. | Missing intermediate rate produces incomplete result, never fabricated final profit. |
| `estimate_build_cost` | `estimate_snapshot_cost` uses explicit snapshot and independent poe.ninja source; migrate legacy callers and skills before removing the old route. | `snapshotCostTool.test.ts` checks model parity and partial failures; `snapshot-cost-live.mjs` checks real PoB and public data. Unknown items stay excluded and subtotal is not a complete buyable price. |
| `search_trade_items` | `search_official_trade` uses the independent source and explicit status; legacy aliases such as `online_only` need caller migration. | `tradeSearchTool.test.ts` compares supported filters with the old query; `source-comparable-live.mjs` verifies international `securable` and priced search, source audit and fetch times. |
| `get_item_price` | Exact-item asking-price sample workflow over official trade. | Limit and currency groups are explicit; asking prices are not sales or full-market statistics. |
| `get_leagues` | `list_trade_leagues` reads official source metadata; migrate existing callers. | Return current source response and errors; no implicit substitution of league. |
| `search_stats` | `search_trade_stats` groups official IDs by identical text and source; legacy static fallback remains separate and pending migration. | Preserve official IDs, source ambiguity and coverage instead of inferring nonexistent sources. |
| `compare_trade_items` | Raw listing comparison over official data. | Report raw values and partial misses without inventing PoB metrics or currency conversion. |
| `find_resistance_gear` | Individual listing search workflow. | Per-item budget and requested resistances remain distinct from combined build affordability. |
| `search_cluster_jewels` | Cluster-jewel trade workflow with local post-filter. | Size, passive count, exact notables and sample-limited coverage stay explicit. |
| `generate_shopping_list` | Snapshot equipment-list workflow with optional market enrichment. | Preserve active item set and distinguish unpriced items from priced purchasable listings. |
| `find_weighted_trade_items` | PoB weight generation combined with official Trade search. | Preserve user league, auth dependencies, candidate scope and no best-in-slot claim. |
| `compare_trade_listing_in_pob` | Official listing fetch plus isolated PoB comparison. | Exact clipboard item and snapshot baseline retained; do not claim listing availability or legality. |
| `compare_trade_listings_in_pob` | Bounded batch listing comparison using one immutable snapshot. | Baseline identity and metrics match per candidate; report each failure independently. |
| `estimate_comparable_item` | `estimate_trade_comparable` composes the independent official source with the extracted comparable policy; legacy route and caller removal are pending. | Preserve query, `securable`, sample, currencies and ambiguity; `source-comparable-live.mjs` checks real source and original retrieval times. |
| `suggest_crafting` | Crafting-context and versioned verified-data feature. | Preserve supplied budget/item context and verified source link; do not invent mechanics or odds. |
| `inspect_item_affix_weight` | `foundation_item_affix_weight` plus item-data presentation. | Separate spawn weight, item-level eligibility and unknowns from crafting probability. |
| `classify_item_affixes` | Versioned PoB modifier classification adapter. | Preserve hybrid/ambiguous matches and only infer slots with complete confirmed inputs. |
| `list_craftable_mods` | Versioned PoB bench-data query. | Respect class, item level, affix type and search without implying full item legality. |
| `find_affix_tiers` | Versioned modifier tier/tag query. | Distinguish broad tag match from caller-confirmed full-tag spawn evaluation. |
| `compare_craft_budget` | Pure economic comparison using externally supplied odds and costs. | Model assumptions and partial input remain visible; supplied odds are not verified game mechanics. |
| `simulate_simple_annul` | Independent narrowly scoped deterministic outcome enumeration. | Reject unsupported item states and count hybrid modifiers once; retain supplied-state assumptions. |
| `find_timeless_jewel_seeds` | Independent PoB-versioned timeless-jewel search feature. | Compare native seed/node transformations, source nodes and keystone filters against real PoB. |

## Local file observation

| Legacy tool | Intended replacement and missing behavior | Tool-specific acceptance |
| --- | --- | --- |
| `start_watching` | Optional file-observation adapter; explicit import is needed to change snapshots. | Detect replacement and duplicate events without mutating an existing snapshot. |
| `stop_watching` | Stop the optional watcher. | Pending events and handles drain on shutdown without changing snapshots. |
| `get_recent_changes` | Bounded watcher event query. | Preserve ordering and limits; distinguish no events from unavailable watcher. |
| `watch_status` | Read-only watcher status. | Report configured directory and actual running state without implying a build was imported. |
