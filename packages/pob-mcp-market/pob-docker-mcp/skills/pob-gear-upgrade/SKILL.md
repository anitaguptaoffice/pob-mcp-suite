---
name: pob-gear-upgrade
description: Find, compare and prioritize equipment upgrades for an existing Path of Exile 1 build, including pasted items, official Trade listings and budgeted multi-slot trials. Price-only appraisals use pob-economy; general build diagnosis uses pob-build-review.
---

# PoB gear upgrades

Read `../../references/recommendation-workflows.md` for baseline and comparison
rules. Discover advertised schemas. Use `../pob-economy/SKILL.md` when searching
or pricing, and `../../references/trade-tools.md` for query details; a pasted
candidate can be compared without either a live market search or a price.

## Establish the intended replacement

Use an explicit imported snapshot and inspect its selected item/weapon set,
equipment and damage scenario with `summarize_snapshot_build` and, where useful,
`analyze_snapshot_equipment`. Record the goal and constraints: target slot,
important stats/mechanics, resource or attribute requirements, socket/link
needs, and any equipment the user wants to keep.

Use a supplied exact international league and budget for shopping. If either is
missing, continue build diagnosis or compare supplied items without presenting
a priced purchase recommendation. Preserve the stated currency; budget bundle
tools accept Chaos Orb budgets, so a conversion needs explicit rate evidence
and uncertainty rather than treating other currency amounts as Chaos Orbs.

## Choose the candidate path

| Input or goal | Current tools |
| --- | --- |
| Pasted PoB item text | `foundation_preview_item` |
| Known official listing IDs and search ID | `preview_trade_listings` |
| Explicit per-slot searches within a Chaos Orb budget | `screen_snapshot_budget_candidates` |
| Combined trial for a few requested slots | `assemble_snapshot_budget_bundle` |
| Query discovery before screening | `search_trade_stats`, `search_official_trade` |
| Build-derived weighted search | `generate_snapshot_weighted_trade`, `search_snapshot_weighted_trade` when advertised |

Translate the stated requirements into source-aware filters with the economy
workflow. Searches default to `securable` and priced listings; keep the exact
query, source time, explicit buyout evidence, currencies, missing listings and
omitted constraints. An item unavailable to the calculator or unpriced in the
sample is not a zero-cost upgrade.

Use a bounded candidate batch. A missing required clipboard payload or listing
identity mismatch ends that candidate's calculation; do not reconstruct a
different item from partial text. Respect authentication and rate-limit
failures instead of silently substituting reference prices.

## Compare the actual change

Read PoB preview results and parsing diagnostics for both current and candidate
items. A candidate's total resistance is not the net gain after removing the
equipped item. Check the same damage, defense and resource fields before and
after the full intended swap. Follow up with a trial and `foundation_evaluate`
if the preview lacks a required field; mark unavailable constraints unverified.

For a materialized change use `foundation_derive_item`, or
`foundation_derive_items` for the complete intended set, with a trial flag.
Use `compare_snapshot_builds` for fresh comparisons. Replacing a weapon and
shield with dual wielding requires a complete equipment change, not the delta
from one independent preview. Cluster jewel changes that alter the tree require
their own supported tree workflow, not an ordinary-jewel comparison.

The budget-bundle tool chooses from a bounded sample; it is not a global
optimizer and does not certify every custom requirement. Inspect its combined
trial, subtotal and incompleteness. Do not sum independent item gains or claim
the selected subtotal covers the whole build. A cheapest sampled item can be
worse for the user's constraints.

## Present a decision

Return a short Simplified Chinese candidate comparison: slot, item, exact price
and currency when known, source link/time, measured gains, losses, and unmet or
unknown constraints. Recommend only within the declared evidence; otherwise
say which candidate is promising and what still needs checking. Keep the
baseline and selected trial IDs available. Save or overwrite a file when the
user's request authorizes it; existing authorization applies without asking
again merely because a trial was generated.

Use `../pob-crafting/SKILL.md` only for a requested crafting alternative. A
crafted item's hypothetical PoB gain does not establish that it can be made or
that its production cost is known.
