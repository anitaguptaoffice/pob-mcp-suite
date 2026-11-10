---
name: pob-crafting
description: Use for Path of Exile 1 item crafting, crafting steps, success probabilities, and comparisons between crafting and buying.
---

# PoB crafting

Use Simplified Chinese and verified Chinese game terms. The user plays the international realm. Verify the item, game version, base, level, existing modifiers, available slots, and currency mechanic before suggesting a step. Explain uncertainty and possible loss of modifiers.

`suggest_crafting` gathers context; it is not a rules engine or probability simulator. Never present its suggestions or fallback prices as verified. A Scouring Orb normally removes all explicit modifiers and returns an item to normal rarity; protection and special-item rules require separate verification.

`compare_craft_budget` is a mathematical repeated-attempt model. It requires independently verified per-attempt probability, the complete cost per attempt, and the probability's source/version. It does not derive odds from PoE data. Distinguish the expected cost from the 50% and 90% budgets, and name any omitted base, salvage, protection, or intermediate-step costs. For market listings, use the separate `pob-economy` skill.

`simulate_simple_annul` enumerates one use of an Orb of Annulment only for an ordinary item when every assumption is explicitly confirmed: no fractured affixes, protection, catalyst weighting, corruption, mirroring, or other special rules. It cannot inspect or validate the item itself. Obtain and verify the complete list of explicit affixes first; a hybrid affix can produce multiple lines. If classification is ambiguous, do not guess. This is a one-use outcome, not a repeatable process.

No broader verified crafting simulator is bundled. Do not invent roll weights, probabilities, or an optimal crafting strategy. If the necessary rule or probability is unknown, say so and request or research the missing information.
