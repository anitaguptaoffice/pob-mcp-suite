# Snapshot workflows

Use this workflow when the server advertises `foundation_import_build`. Each
tool takes an explicit snapshot ID; there is no current mutable build. Check the
advertised schemas because the migration is incomplete and capabilities differ
by server configuration. Never assume legacy tools are exposed alongside it.

## Import and inspect

- Import XML with `foundation_import_build` (`xml`, `source`), an existing local
  file with `foundation_import_file` (`build_name`), or a PoB share code with
  `foundation_import_code` (`code`). A URL is not a share code: obtain its code
  or XML separately. Save the returned snapshot ID.
- Call `foundation_inspect` with that `snapshot_id` and the needed `sections`
  from `build`, `tree`, `items`, `skills`, and `config`. Use its real PoB state
  to identify the active tree, equipment, selected skill and conditions.
- Call `foundation_evaluate` with the same `snapshot_id` and explicit `fields`.
  Include the returned configuration and skill selection when interpreting
  results. Read `metrics` status and report unknown values as unknown, not zero.
  Treat player, minion, combined and full damage as distinct metrics; do not add
  them together without establishing what PoB already includes.
- Evaluation `selection` and `config` overrides apply only to that calculation;
  they do not change the snapshot. Compare results under the same settings.
- To save a selection, use `foundation_derive_selection` with a nonempty
  `selection`: `mainSocketGroup`, `mainActiveSkill`, and `skillPart` are separate
  one-based PoB indices. Inspect and evaluate the child to confirm the result.

## Isolated changes and export

- Derive a child with the appropriate advertised `foundation_derive_*` tool.
  `foundation_derive_tree` takes explicit additions/removals and does not find
  paths; use `foundation_search_tree` and mastery option tools to inspect
  candidates. `foundation_derive_item` equips an explicit slot. Config and
  character level have dedicated derivations. `foundation_derive_gem` changes
  an existing gem's level, quality or enabled state using explicit one-based
  group and gem indices; its existing quality type is retained. Changing a
  quality type is not yet available in this mode. Use
  `foundation_derive_gem_list` to add a uniquely resolved gem or remove an
  existing one by index; it does not verify socket legality or game availability.
- Use `foundation_derive_skill_group` to create a new group and its ordered gems
  atomically. An unrecognized or ambiguous gem prevents publishing the child;
  this operation does not verify socket legality or game availability.
- Use `compare_snapshot_trees` for allocated node and mastery differences between
  two snapshots with the same known tree version. It does not prove legality,
  compute point cost, or measure the resulting damage.
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
