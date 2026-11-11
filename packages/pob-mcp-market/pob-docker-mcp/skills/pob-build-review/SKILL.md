---
name: pob-build-review
description: Diagnose an existing Path of Exile 1 build, explain damage or survival problems, and prioritize measured improvements using the PoB MCP service. Use for overall build advice; targeted equipment shopping uses pob-gear-upgrade.
---

# PoB build review

Read `../../references/recommendation-workflows.md` for the shared baseline,
comparison rules and response contract. Discover the connected server's schemas;
use `../pob-docker-mcp/SKILL.md` only when connection/import details are needed.

## Diagnose before recommending

Start with the user's build and stated problem. Reuse a supplied snapshot ID or
import the supplied file/XML/share code. A named source must resolve to that
source. Reuse its saved scenario and report it; ask only for missing information
that changes the recommendation. A whole-build review can proceed while an
optional shopping budget is unknown.

Use `summarize_snapshot_build` to identify the selected skill, tree, equipment
sets, configuration and relevant metrics. Use `check_snapshot_issues` to collect
leads, then verify each material lead against PoB observations. Its thresholds
and keyword checks are heuristics, not a definitive verdict on the build.

Choose the detailed inspection needed for the question:

| Question | Current tools |
| --- | --- |
| Dying or missing defensive layers | `inspect_snapshot_defenses`, `foundation_evaluate` |
| Ailment or enemy configuration | `inspect_snapshot_ailments`, `derive_snapshot_enemy_config` |
| Selected gems or support application | `inspect_snapshot_skill_groups`, `compare_snapshot_support_contributions` |
| Nearby passive choices and path cost | `find_snapshot_passive_suggestions`, `find_snapshot_tree_path`, `find_snapshot_nearby_nodes` |
| Equipped item/slot context | `analyze_snapshot_equipment` |

Do not infer an arbitrary universal resistance cap, required life pool or boss
readiness from one stat. Verify whether the chosen player, minion or full damage
metric describes this build. Check requirements and resource costs when a
proposed change can affect them; unavailable fields stay unknown.

## Test a small set of improvements

Select candidates that address the observed issue. Use the existing modules:
`compare_snapshot_gem_upgrades`, `rank_discovered_snapshot_supports`,
`rank_snapshot_mastery_effects` and `rank_snapshot_anointments`. For longer
passive searches, use `submit_snapshot_passive_ranking` and
`summarize_snapshot_passive_ranking`; keep failures and unfinished candidates
visible. Read `../../references/tree-optimization.md` when changing paths.

Make isolated trial children from the same baseline. Compare saved build
versions using `compare_snapshot_builds`; use `foundation_inspect` to verify the
intended edit when a numeric delta is surprising. Changed skill/enemy settings
can explain an apparent improvement. An accepted edit is not proof of a gain.

Prioritize confirmed problem fixes, then measured improvements with stated
tradeoffs. A suggestion without a usable calculation is an untested option,
not a ranked upgrade. An alphabetical support-discovery page is not an
exhaustive recommendation. Do not add individual candidate gains together.

For purchasing decisions, continue with `../pob-gear-upgrade/SKILL.md`; price-only
questions use `../pob-economy/SKILL.md`. Load those only when the task needs them.

Return a concise Simplified Chinese diagnosis, evidence, proposed changes and
measured tradeoffs. Identify the baseline and trial IDs. Persist files only
when requested; a diagnostic review can finish without writing a build file.
