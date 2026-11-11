# Snapshot workflows

Use this workflow when the server advertises `foundation_import_build`. Each
tool takes an explicit snapshot ID; there is no current mutable build. Check the
advertised schemas because the migration is incomplete and capabilities differ
by server configuration. Never assume legacy tools are exposed alongside it.

## Import and inspect

- `inspect_local_cached_stats` reads historical PlayerStat and MinionStat values
  saved in a named file; `inspect_snapshot_cached_stats` reads those in a
  captured snapshot. Use the returned XML fingerprint when continuing pages.
  Duplicates and raw strings are preserved, and missing fields are null. These
  values can be stale or absent: use `foundation_evaluate` for calculations
  against the current PoB engine and selected configuration.
- Create a new build with `foundation_create_build`, providing the PoB class
  name and optionally an ascendancy and `tree_version`. Special-season
  ascendancies require the matching tree version; the name is checked against
  that version. The durable root snapshot is published only after reload checks.
- Discover old named history with `list_legacy_build_history`, checking
  `complete`, `issues` and the catalog fingerprint when paging. To analyze one
  entry, call `import_legacy_build_history` with its exact origin, ID and
  metadata digest. Import does not delete or alter the old XML and metadata.
  The original metadata is copied to a durable history record; inspect it via
  `list_snapshot_history`. Legacy cached stats are historical values, not
  recalculated results. If recording metadata fails after import, the error
  identifies the durable snapshot; retry the same import to record it.
- An `XML_WITHOUT_READABLE_METADATA` issue may represent an old backup or an
  incomplete history entry. Inspect it with `inspect_unpaired_legacy_xml`,
  then pass the returned digest to `import_unpaired_legacy_xml` if the user
  wants to recover it. The original tag, timestamp and purpose are unknown;
  the saved recovery metadata is explicitly synthetic and preserves the filename.
- Use `save_snapshot_history` to retain a snapshot with an explicit build name,
  tag and description. `list_snapshot_history` filters by exact name and tag;
  use its fingerprint when paging. Retention can succeed even if writing the
  history record fails. Saving history does not overwrite a build file.
- To restore over an existing build file, first call `inspect_local_build_file`
  and pass its `sha256` as `expected_current_sha256` to `restore_snapshot_file`.
  The default creates a durable `before-restore` history snapshot; an invalid
  existing PoB file cannot be backed up this way and the restore fails. A file
  change detected before replacement aborts, but another writer can still race
  the final check. Retention or a backup may remain after a failed restore. The
  in-memory PoB application is not reloaded automatically.
- Use `foundation_derive_items` to test up to ten explicitly specified items in
  distinct equipment slots together. A failure publishes no partial child;
  inspect the resulting equipment and compare calculations before retaining it.
  Slot acceptance does not prove item legality or market availability.
- Use `foundation_derive_auto_item` only when PoB should choose an empty
  compatible slot. It returns the selected slot and child snapshot; it fails
  without publishing if no slot is selected. Each equipment set is checked with
  the active tree and each tree with the active set, not every combination. The
  check does not establish in-game item legality.
- Use `foundation_derive_inventory_item` to save a candidate without equipping
  it, then `foundation_item_inventory` to list items by ID; continue with
  `nextAfterItemId` when present. The child is checked after reload and does not
  alter the parent. Each equipment set is checked with the active tree and each
  tree with the active equipment set; their full cross-product is not checked.
  PoB parsing does not establish item legality or availability.
- Use `analyze_snapshot_equipment` for one slot or the active equipment set and
  its PoB stats and calculation context. Its separate legacy suggestions are
  unverified heuristics; hidden, inactive, unresolved, visibility-unknown and
  unsupported slots are excluded. Active swap weapons remain identified by
  their actual slot name. Use `foundation_preview_item` for a specific replacement
  and independent Trade tools for current securable priced listings.
- For leveling context, `prepare_snapshot_leveling` reads the selected PoB skill,
  class and ascendancy from the snapshot. Its legacy campaign and starter-skill
  examples are unversioned and unverified, not an actual passive route or proof
  of gem availability, quest rewards, recipe validity or lab timing. Confirm
  current game information and the user's progress before giving directions.
- Use `foundation_replace_tree` only with a complete explicit target tree,
  including the exact version, class, ascendancy, allocated node IDs and mastery
  selections. The new child is checked against the requested tree and inactive
  specs after reload. Existing node overrides cause a refusal by default; use
  `override_policy: preserve` to keep existing overrides on the same tree
  version. Cross-version preservation and new target overrides are unsupported;
  legality and connectivity remain unverified.
- Use `list_local_build_files` to discover XML names under the configured build
  directory, including nested folders. Check `complete` and `issues`; absence
  from a partial scan is not proof that a file does not exist. For more pages,
  pass both `nextCursor` as `after` and the `catalogFingerprint` as
  `catalog_fingerprint`; restart the listing if it changed. Listing files does
  not import them, and hidden paths and symlinks are excluded.
- To observe subsequent local edits, use `start_local_build_watch`, inspect
  `get_local_build_watch`, and read `list_local_build_changes`. Pass the returned
  session ID with a nonzero `after_sequence`; `lostBefore` signals that older
  events were evicted. Events are process-local and best effort. They do not
  change snapshots: import a selected file again to capture its new content.
  Stop observation with `stop_local_build_watch` when no longer needed.
- Import XML with `foundation_import_build` (`xml`, `source`), an existing local
  file with `foundation_import_file` (`build_name`), or a PoB share code with
  `foundation_import_code` (`code`). The code must encode a compressed PoB
  build. Official passive-tree URLs and their uncompressed codes are not PoB
  build codes and are not supported by this import. A share URL is not itself a
  share code: obtain its code or XML separately. Save the returned snapshot ID.
- To apply an official passive-tree URL or its raw code, use
  `derive_snapshot_official_tree` with an explicit existing `snapshot_id` and
  `tree_version`. The URL does not encode the PoB tree version; confirm it
  from the source before calling. PoB verifies all encoded nodes and masteries
  in an isolated child, and the default is a seven-day trial. Existing node
  overrides cause rejection. Official tree codes omit jewel assignments,
  overrides, equipment and skills; the target keeps its own other data. Cluster
  nodes may fail without matching socketed jewels; errors show counts and up to
  20 missing and unexpected node IDs. No point or game legality is
  established. This is separate from compressed PoB build-code import.
- Call `foundation_inspect` with that `snapshot_id` and the needed `sections`
  from `build`, `tree`, `items`, `skills`, and `config`. Use its real PoB state
  to identify the active tree, equipment, selected skill and conditions.
- For a broad single-build overview, use `summarize_snapshot_build`. It returns
  structured sections, selected skills, allocated node details and distinct
  PoB metrics from one isolated observation. `specs` and `itemSets` identify
  the active configurations and other available sets. `status: partial`, missing metrics,
  unresolved node IDs and section errors must remain visible. Occupied hidden
  or inactive slots are included; set `include_item_text: true` only when full
  equipment text is needed. Explain results to users in Simplified Chinese.
- Call `foundation_evaluate` with the same `snapshot_id` and explicit `fields`.
- For a broader predefined set, `evaluate_snapshot_stat_category` accepts
  `offense`, `defense` or `all`; `all` is the bounded union of those categories,
  not every available PoB stat. Inspect the selected skill and configuration,
  and distinguish true zero from unknown. Player, minion and full damage may
  overlap and must not be added mechanically.
  Include the returned configuration and skill selection when interpreting
  results. Read `metrics` status and report unknown values as unknown, not zero.
  Treat player, minion, combined and full damage as distinct metrics; do not add
  them together without establishing what PoB already includes.
- Evaluation `selection` and `config` overrides apply only to that calculation;
  they do not change the snapshot. Compare results under the same settings.
- Use `inspect_snapshot_defenses` for grouped PoB health pools, resistances,
  avoidance, mitigation, recovery and ailment avoidance. It returns saved calculation context and
  per-metric availability. Unknown values are not zero; 1 life does not imply
  a broken build when energy shield is the primary pool. Effective hit pool,
  maximum hit and recovery answer different questions, and all depend on PoB's
  configured conditions. `check_snapshot_issues` is a separate partial heuristic
  scan, not a complete defense score or survival guarantee. Ailment avoidance
  reflects saved conditions such as flask activation: 100% is not proof of
  permanent immunity, removal of existing ailments, or corrupted blood protection.
- `check_snapshot_issues` includes PoB's player hit chance and mana recovery
  when available. A low hit-chance observation requires checking the actual
  calculation selection and whether player accuracy applies; it is not minion
  accuracy. The scan also compares `ManaCost` with PoB's `ManaCostPayablePool`
  for the calculated skill, which may differ from the main skill. A warning is
  an observation to investigate, not proof that a triggered skill cannot work.
  Recovery figures alone do not prove a skill is sustainable, and an unknown
  observation is not a pass. Full immunity and build validation remain outside
  this partial scan.
- The scan also reports enabled supports that PoB confirms do not apply to the
  selected skill in the active main group. An unknown application or inactive
  group is not reported as a confirmed failure. Application alone does not
  establish damage gain, socket legality or availability; compare explicit
  candidates using an appropriate player or minion damage metric.
- Use `inspect_snapshot_ailments` to inspect player non-damaging ailment effects
  under the saved skill and enemy configuration. `appliedEffect` is what PoB
  credits; `calculatedEffect` is a separate estimate, not an uptime guarantee.
  Review `uncredited` and `unknown`. When the calculation-tab selection does not
  match the main skill, estimates and thresholds are withheld instead of mixed.
  Minion and damaging ailments and freeze duration are outside this report.
- Use `save_snapshot_config_preset` to persist every observed configuration
  value in the versioned local preset store; overwrite requires `overwrite: true`.
  `list_local_config_presets` and `read_local_config_preset` also expose legacy
  presets without modifying them. Specify `origin` when both stores have the
  same name; legacy presets lack source-version provenance. Apply with
  `apply_snapshot_config_preset`, which verifies saved settings and preserves
  target settings absent from the preset before publishing a child snapshot.
  Current presets also preserve automatic versus explicit enemy-level mode;
  an automatic level can resolve differently for the target build. Older preset
  formats did not record this mode and report it as unknown.
  PoB-rejected changed values fail the whole operation; an unchanged obsolete
  value can remain in place. Inspect and evaluate the resulting child.
- For explicit enemy level, resistance, armour and evasion changes, use
  `derive_snapshot_enemy_config`; only submitted values are changed. Its optional
  comparison reports separate player and minion metrics. An unavailable metric
  or failed comparison is not zero; the derived snapshot ID remains available.
  PoB may discard an explicit enemy level equal to its default when saving; if
  reload loses the fixed setting, the operation fails without publishing a child.
- To save a selection, use `foundation_derive_selection` with a nonempty
  `selection`: `mainSocketGroup`, `mainActiveSkill`, and `skillPart` are separate
  one-based PoB indices. Inspect and evaluate the child to confirm the result.

## Compare builds and edit notes

- Import each build separately and keep both returned IDs. Call
  `compare_snapshot_builds` with `baseline_snapshot_id` and
  `candidate_snapshot_id`; optionally supply the exact PoB metric `fields`.
  The comparison evaluates each build in its saved context. Check the returned
  `comparability`, skill and config contexts, metric statuses and warnings before
  interpreting deltas. Different configurations or tree versions can explain a
  difference; unknown or different engine identities limit comparability.
  For a controlled change, derive a child from one parent and compare those IDs.
- Read notes using `foundation_read_notes` with `snapshot_id`. To replace them,
  call `foundation_derive_notes` with that ID and the complete new `notes` text;
  use an empty string to clear them. Set `mode: append` to append nonempty
  text, separating it from existing nonempty notes with `\n\n---\n\n`.
  Empty append text leaves existing notes unchanged. The returned child ID is the edited build;
  neither the parent nor an existing file is changed. Read the child notes back.
  If a local file should be updated, explicitly call `foundation_save_file` for
  the child, specifying `build_name` and `overwrite: true` only when replacing
  an existing file is intended. `create_directories: true` explicitly creates
  missing parent directories under the configured build root; it requires Linux
  `/proc/self/fd`, refuses symlink components and defaults to false. Retention
  or directory creation may succeed even if the file write fails. Re-import the
  file to verify persisted notes.
  Retention and file-write results must be checked separately.

## Isolated changes and export

- Derive a child with the appropriate advertised `foundation_derive_*` tool.
  `foundation_derive_tree` takes explicit additions/removals and does not find
  paths; use `foundation_search_tree` and mastery option tools to inspect
  candidates. `foundation_derive_item` equips an explicit slot. Config and
  character level have dedicated derivations. `foundation_derive_gem` changes
  an existing gem's level, quality or enabled state using explicit one-based
  group and gem indices. `qualityId: Default` is the only explicit quality type
  accepted. The tested PoB version reports a legacy alternate `qualityId` as
  Default after import; read-only calculations report this as a warning. Any
  derivation from a snapshot containing a non-default gem `qualityId` is refused
  to prevent silent loss. The original imported snapshot retains its source XML;
  conversion and historical quality mechanics are not supported. Use
  `foundation_derive_gem_list` to add a uniquely resolved gem or remove an
  existing one by index; it does not verify socket legality or game availability.
- Use `foundation_derive_skill_group` to create a new group and its ordered gems
  atomically. An unrecognized or ambiguous gem prevents publishing the child;
  this operation does not verify socket legality or game availability.
- Use `foundation_derive_skill_group_enabled` to enable or disable a specific
  group in a child snapshot. Recalculate the relevant damage metrics afterwards.
- `foundation_remove_skill_group` removes one group. When the selected main
  group is removed and other groups remain, supply `replacement_main_group` using
  the indices after removal. If a separately selected calculation-tab group is
  removed, supply `replacement_calcs_group` using the indices after removal.
  Other selected groups are reindexed to preserve their identities.
- Use `foundation_derive_flask_active` for an explicit PoB flask activation
  state and evaluate the child to measure its effect. This does not establish
  whether the flask can be kept active in game.
- `foundation_item_sets` lists PoB item-set IDs. Use `foundation_derive_item_set`
  to select one in a child snapshot, then inspect and evaluate that child. The
  switch verifies all sets on reload and rejects catalogs larger than 100 sets.
- `foundation_specs` lists passive-tree spec indices. Use
  `foundation_derive_spec` to select one in a child snapshot; the switch checks
  each spec's tree and equipment observations on reload and rejects catalogs
  larger than 100 specs.
- `foundation_create_spec` creates a blank spec or copies `copy_from`, with an
  explicit `activate` option. `foundation_rename_spec` changes a spec's title;
  both produce a new snapshot and verify the other spec observations.
- `foundation_delete_spec` deletes a spec in a child snapshot; provide
  `replacement_spec` using the indices after deletion when deleting the active
  spec. PoB requires at least one spec to remain.
- Use `compare_snapshot_trees` for allocated node and mastery differences between
  two snapshots with the same known tree version. It does not prove legality,
  compute point cost, or measure the resulting damage.
- Use `inspect_snapshot_cluster_jewels` for the active tree's socketed cluster
  jewels and PoB-generated notable allocation. `graphAvailable: false` or a
  missing socket allocation means the corresponding state is unknown; do not
  report missing graphs as jewels with no notables. This does not assess synergy,
  DPS, legality or jewels stored outside the active tree. Use a separate
  `search_cluster_listings` query for bounded international Trade candidates.
  `include_legacy_heuristic: true` additionally returns old gem-name and raw-item
  keyword matches, with gem enabled states and PoB allocation when uniquely
  observable. These unversioned matches include disabled and inactive gems and
  do not prove synergy; unmatched names do not prove poor synergy.
- Use `inspect_snapshot_watchers_eye` for source-backed Watcher's Eye modifier
  candidates matching saved gem names. Check each gem's `enabledState` and
  `matchKind`; an enabled aura gem does not prove the character is affected,
  and Vaal-name matches are only candidates. The PoB table can include legacy
  variants. No ranking, current item availability or damage gain is established;
  verify explicit candidates in PoB and prices through official Trade separately.
- To compare up to three explicit ordinary jewel item texts, use
  `compare_snapshot_jewels` with an allocated `socket_node_id` and the exact PoB
  `fields` to compare. It creates separate seven-day trial children and reports
  PoB parse diagnostics for the equipped and candidate jewels. Inspect unparsed
  lines, missing metrics, changed contexts and candidate errors before interpreting
  deltas. `contextComparison: generated_group_reindexed` means a uniquely
  matched generated group moved while ordinary group order and main/calculation
  selections remained unchanged. Such deltas are `context_reindexed_unverified`;
  review whether group order affects the build. Other context changes withhold
  deltas. A child ID can be returned even
  if its later comparison failed. Retain a desired child explicitly. Cluster and unsupported jewel bases are excluded;
  legality, aura uptime and item prices are not established.
- For longer comparisons, `submit_snapshot_jewels` queues up to ten candidates;
  poll `summarize_snapshot_jewels` and inspect each result. Cancellation takes
  effect after the current candidate. Candidate text and completed progress are
  stored locally. Recorded child IDs survive interruption, but a crash between
  child creation and recording its ID can leave an unreferenced trial. Interrupted
  stores require the documented explicit stale-lock recovery before restart.
  Trial children expire after seven days unless explicitly retained.
- For a saved local file without starting PoB, `inspect_local_cluster_jewels`
  reads its active tree spec, socket references and serialized item text. Check
  `socketDataAvailable`, `unresolvedSockets`, the file digest and warnings.
  Listed notable names and `serializedNodePresent` do not establish runtime
  allocation; import the file and use the snapshot tool for PoB graph results.
- Use `trial: true` for experiments. Trial snapshots default to seven days;
  retain a wanted result with `foundation_retain_snapshot`. Check returned IDs
  and retention metadata rather than assuming the parent changed. Inspect and
  evaluate the child and parent independently before reporting differences.
- `foundation_export_build` returns XML. `foundation_save_file` explicitly saves
  under the configured build directory; overwrite defaults to false. Its
  retention step can succeed even if the file write fails, so report both results
  accurately. Re-import the saved file to verify an export when required.
- Do not claim an item is obtainable, a tree is optimal, or a support gem raises
  damage merely because it was accepted or listed as compatible. Source errors,
  engine/data version warnings, partial results and missing metrics stay visible.

## Compare explicit gem setups

- Use `inspect_snapshot_skill_groups` to inspect the saved main group, an
  explicit one-based `group_index`, or every group with `all_groups: true`.
  Disabled groups and gems remain visible. Unknown gem classification and
  support-application state must not be interpreted as confirmed compatibility.
  Each group's `assessment` summarizes observed enabled gems, multiple active
  gems and support application; unknown inputs stay unknown. Gem counts do not
  prove sockets are connected, and item-granted skills may exist without active
  gems. Level and quality alone do not establish corruption state, benefit or price.
- To compare explicit level or quality changes, call
  `compare_snapshot_gem_upgrades` with the saved main `group_index` and up to
  three candidates containing `gem_index` and `level` and/or `quality`. Each
  candidate changes one gem in its own trial. Check each `comparison.status`,
  baseline, identity warnings and the appropriate player or minion metric;
  an error can still return a trial ID. The tool neither combines candidates
  nor establishes cost, availability, corruption or socket legality.
- Use the selected main group's one-based index. Submit
  `submit_snapshot_gem_setups` with `snapshot_id`, `group_index`, and 2–5
  `setups`: each has a unique `name` and a complete `gems` array of 1–6
  objects with `gemName` and optional `level`, `quality`, and `enabled`.
  Every setup must retain the enabled active gem. Existing gem properties are
  retained unless explicitly changed; newly added gems default to level 20 and
  quality 0. The tool compares the submitted candidates, not every possible gem.
- Poll `summarize_snapshot_gem_setups` with the returned `job_id`. Pending,
  failed, and unranked entries make the result partial; preserve their reasons
  and any returned trial snapshot IDs. `foundation_cancel_job` requests a stop
  after the current item. Check baseline, metric availability, identity warnings
  and skill context before interpreting deltas. Trial snapshots expire after
  seven days unless retained; neither the source snapshot nor a file changes.
- The computation does not establish gem availability, socket colours, mana
  requirements or in-game legality. Inspect and evaluate the selected trial,
  then retain or save it explicitly if the user wants to keep it.

## Discover and compare supports

- To investigate existing supports, inspect the saved main group first, then use
  `compare_snapshot_support_contributions` with its group index and up to three
  explicit gem indices. It separately disables each support PoB confirms is
  applied, compares each trial with the unchanged parent, and reports failures
  or unknown application individually. The candidate delta is the change when
  the support is removed, not the gain from adding it; effects interact, so do
  not add the deltas. Choose the relevant PoB metric and
  inspect its availability and identity warnings; for poison minions this can
  be `MinionCombinedDPS`. This measures the configured scenario, not support
  uptime, a universal more multiplier, penetration, legality or an optimum.
  If the comparison rejects a multi-active-gem group or other changed context,
  report the limitation rather than guessing from the gem name.
- Use `rank_discovered_snapshot_supports` with the saved main `group_index`,
  the enabled support `gem_index` to replace and an explicit metric such as
  `MinionCombinedDPS` for poison-inclusive minion damage. PoB finds compatible
  candidates; at most four unsocketed, deduplicated candidates are then tried in
  separate trial snapshots. Discovery is alphabetically ordered and bounded,
  not an exhaustive optimizer; use a query or explicit candidate comparisons
  to explore other gems.
- Review discovery failures, identity warnings and every candidate's status.
  Only supports confirmed applied by PoB are ranked. Gem availability, socket
  colours, mana sustain and prices are not established.

## Rank nearby passive paths

- Submit `submit_snapshot_passive_ranking` with `snapshot_id` and one or two
  explicit higher-is-better PoB `metrics`, for example `MinionCombinedDPS`
  for poison-inclusive minion damage when available and `TotalEHP` for the
  chosen defensive comparison. Set `max_distance`, `limit`, and optional
  `filter` to control discovery. `excluded_node_ids` rejects any discovered
  path containing one of those IDs, including intermediate nodes; exclusions
  apply to new allocations, not nodes already allocated. Exclusions are applied
  after the discovery limit, and alternative paths are not sought.
  Set `min_life` and/or `min_energy_shield` to require minimum PoB values on
  each candidate, independent of scoring metrics. Candidates below a minimum
  are reported separately and not ranked; unavailable values are unknown.
  Confirm metric meanings and baseline values
  for the build; player and minion damage are separate and must not be added.
- Poll `summarize_snapshot_passive_ranking` with the returned `job_id`. The score
  sums relative changes in the specified metrics and divides by path point cost;
  two metrics therefore have equal weight. Excluded, failed, pending and
  unranked entries are not evidence of a complete search. Discovery is bounded,
  excludes ascendancy and blighted notables, and does not select mastery effects.
  Verify point availability, legality and build mechanics before applying a path.
  Results are seven-day trial snapshots; retain or save a chosen child explicitly.

## Search timeless jewel seeds

- `search_snapshot_timeless_seeds` uses a snapshot, socket node ID and PoB
  effect IDs to search Elegant Hubris seeds. Hits include allocated and
  unallocated nodes. `required_source_node_ids` is an any-of filter: at least
  one listed original notable must receive a requested seed-dependent effect.
  The fixed Caspiro keystone requires a separate seed-dependent hit as well.
  Confirm allocation, item availability and cost independently.

## Transplant a passive tree

- Call `transplant_snapshot_tree` with explicit `source_snapshot_id` and
  `target_snapshot_id`. It derives a child of the target, copying the source's
  active class, ascendancy, node and mastery selections. The default is a
  seven-day trial. Source and target node overrides are rejected; source jewel
  assignments and other source build data are not copied. Point availability
  and in-game legality are not established.
- Review the resulting snapshot. The target's equipment, skills, configuration
  and inactive specs are checked, but other serialized metadata is not fully
  compared. No build file changes during the transplant. If an existing local
  build must be replaced, call `inspect_local_build_file`, then explicitly call
  `restore_snapshot_file` with the returned current fingerprint. A durable
  backup is saved by default; an external writer can still race the replacement.

## Compare anointments

- Call `rank_snapshot_anointments` with a `snapshot_id`, equipped `slot`, and
  `focus`. For `dps` or `both`, supply the relevant `damage_metric` explicitly;
  select a minion metric when the damage being compared belongs to minions.
  `enchant_slot` selects the one-based enchantment slot and defaults to 1. The
  baseline removes that enchantment if present, which may be a different
  enchantment rather than an anointment; check `baseline.removedEnchant` before
  interpreting the deltas relative to the currently equipped item.
- Review the skipped count, result limit and score definition. PoB ranks
  unallocated recipe candidates only; the result does not verify whether the
  recipe, item or oils can be obtained or afforded in the current game version.
