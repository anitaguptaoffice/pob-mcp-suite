---
name: pob-crafting
description: Use for Path of Exile 1 item crafting, crafting steps, success probabilities, and comparisons between crafting and buying.
---

# PoB crafting

Use Simplified Chinese and verified Chinese game terms. The user plays the international realm. Verify the item, game version, base, level, existing modifiers, available slots, and currency mechanic before suggesting a step. Explain uncertainty and possible loss of modifiers.

When advertised, `prepare_crafting_context` gathers an explicitly supplied base
or an active equipped item from a snapshot. It does not validate the target's
item level, modifiers, special state, eligibility or crafting steps. Optional
`verify_base: true` checks the PoEDB page title only. For an exact international
league, obtain reference currency prices separately with
`reference_currency_rates`; use a securable priced official Trade search for
buyable comparisons. On a legacy server `suggest_crafting` gathers similar
context. Neither tool is a rules engine or probability simulator. A Scouring Orb
normally removes all explicit modifiers and returns an item to normal rarity;
protection and special-item rules require separate verification.

When advertised, `classify_modifier_lines`, `query_bench_modifiers`, and
`query_modifier_tiers` provide PoB table evidence without a loaded build. Check
the returned data fingerprints, unknown slot counts, pagination, and warnings.
Only supply `item_tags` with `item_tags_complete: true` after independently
confirming the complete tag set including `default`; a broad `slot_tags` match
does not prove eligibility. A base spawn rule is neither a crafting probability
nor proof that a modifier can be obtained on the item. On older servers, inspect
advertised tools and use their corresponding legacy queries if available.

`compare_craft_budget` is a mathematical repeated-attempt model. It requires independently verified per-attempt probability, the complete cost per attempt, and the probability's source/version. It does not derive odds from PoE data. Distinguish the expected cost from the 50% and 90% budgets, and name any omitted base, salvage, protection, or intermediate-step costs. For market listings, use the separate `pob-economy` skill.

`simulate_simple_annul` enumerates one use of an Orb of Annulment only for an ordinary item when every assumption is explicitly confirmed: no fractured affixes, protection, catalyst weighting, corruption, mirroring, or other special rules. It cannot inspect or validate the item itself. Obtain and verify the complete list of explicit affixes first; a hybrid affix can produce multiple lines. If classification is ambiguous, do not guess. This is a one-use outcome, not a repeatable process.

No broader verified crafting simulator is bundled. Do not invent roll weights, probabilities, or an optimal crafting strategy. If the necessary rule or probability is unknown, say so and request or research the missing information.
