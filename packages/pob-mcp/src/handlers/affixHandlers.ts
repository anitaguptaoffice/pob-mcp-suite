/**
 * Affix and crafting intelligence, read straight out of Path of Building's own mod tables.
 *
 * These three answer the questions the item recipe used to make an agent answer by hand:
 * what affixes an item already carries, what the bench can add, and what a stat is worth.
 */

import type { AffixSlot } from "../services/modDataStore.js";
import { loadAllMods } from "../services/modDataStore.js";
import { resolveAffixes } from "../domain/modifiers/affixMatcher.js";
import { findAffixTiers, findCraftableMods, firstMatchingSpawnRule } from "../services/affixQuery.js";
import { wrapHandler } from "../utils/errorHandling.js";

const text = (lines: string[]) => ({ content: [{ type: "text" as const, text: lines.join("\n") }] });

const affixType = (value: string | undefined): AffixSlot | undefined =>
  value === "Prefix" || value === "Suffix" ? value : undefined;

const tierRange = (statLines: string[]): string => statLines.join(" / ");

export async function handleClassifyItemAffixes(args: { mod_lines: string[]; rarity?: string; explicit_mods_complete?: boolean; ordinary_capacity_confirmed?: boolean }) {
  return wrapHandler("classify item affixes", async () => {
    const lines = args.mod_lines ?? [];
    if (!lines.length) throw new Error("mod_lines was empty. Pass the item's explicit mod lines, one per entry.");
    if (args.rarity !== undefined && args.rarity !== 'rare' && args.rarity !== 'magic') throw new Error('rarity must be rare or magic');
    if (args.explicit_mods_complete !== undefined && typeof args.explicit_mods_complete !== 'boolean') throw new Error('explicit_mods_complete must be a boolean');
    if (args.ordinary_capacity_confirmed !== undefined && typeof args.ordinary_capacity_confirmed !== 'boolean') throw new Error('ordinary_capacity_confirmed must be a boolean');

    const resolution = resolveAffixes(lines, loadAllMods());
    const capacity = args.rarity === 'rare' ? 3 : args.rarity === 'magic' ? 1 : null;
    const overflow = capacity !== null && (resolution.prefixCount > capacity || resolution.suffixCount > capacity);
    const slotsKnown = capacity !== null && args.explicit_mods_complete === true && args.ordinary_capacity_confirmed === true && !overflow &&
      resolution.openPrefixes !== null && resolution.openSuffixes !== null;
    const matchedCounts = `Matched prefixes: ${resolution.prefixCount}${capacity === null ? '' : `/${capacity}`}   Matched suffixes: ${resolution.suffixCount}${capacity === null ? '' : `/${capacity}`}`;

    const body = resolution.affixes.flatMap((affix) => {
      const tierList = affix.tiers.length
        ? affix.tiers.map((tier) => `ilvl ${tier.level} "${tier.affix}" ${tierRange(tier.statLines)}${tier.source === "master" ? " [bench craft]" : ""}`)
        : ["no tier in the data covers these values"];

      return [
        `${affix.type} "${affix.affix}" (${affix.group})${affix.valuesOutOfRange ? " [wording matched, values outside every tier]" : ""}`,
        ...affix.lines.map((line) => `    ${line}`),
        `    Minimum item level: ${affix.minItemLevel ?? "unknown, the values match no tier"}`,
        ...(affix.lines.length > 1 ? [`    Hybrid: these ${affix.lines.length} lines are ONE ${affix.type.toLowerCase()}, not ${affix.lines.length}.`] : []),
        ...tierList.map((tier) => `    tier: ${tier}`),
        ...(affix.alternatives.length ? [`    Ambiguous: these lines could also be ${affix.alternatives.join("; ")}`] : []),
        "",
      ];
    });

    return text([
      "=== Affix Classification ===",
      "",
      ...(!slotsKnown
        ? [matchedCounts, 'Open affix slots: unknown. Verify rarity, complete explicit modifiers and item state in game before recommending a craft.',
          ...(overflow ? ['WARNING: Matched counts exceed the supplied rarity capacity.'] : [])]
        : [`Prefixes: ${resolution.prefixCount}/${capacity} (${capacity! - resolution.prefixCount} open)   Suffixes: ${resolution.suffixCount}/${capacity} (${capacity! - resolution.suffixCount} open)`,
          'Slot counts assume the caller supplied every explicit modifier and that no special item rules change capacity.']),
      "",
      ...body,
      ...(resolution.unmatched.length
        ? ["Unmatched lines (affix type and slot occupancy unknown):", ...resolution.unmatched.map((line) => `  ${line}`), ""]
        : []),
      ...resolution.warnings.map((warning) => `WARNING: ${warning}`),
    ]);
  });
}

export async function handleListCraftableMods(args: {
  item_class: string;
  item_level: number;
  affix_type?: string;
  search?: string;
}) {
  return wrapHandler("list craftable mods", async () => {
    const result = findCraftableMods({
      itemClass: args.item_class,
      itemLevel: args.item_level,
      affixType: affixType(args.affix_type),
      search: args.search,
    });

    if (!result.mods.length && !result.lockedByItemLevel.length) {
      return text([
        `No bench crafts found for item class "${args.item_class}".`,
        "",
        `Known item classes: ${result.knownItemClasses.join(", ")}`,
      ]);
    }

    const render = (mods: typeof result.mods) =>
      mods.map((mod) => `  [${mod.type}] ilvl ${mod.level} "${mod.affix}" ${mod.statLines.join(" / ")}${mod.statLines.length > 1 ? "  (hybrid: one affix)" : ""}`);

    return text([
      `=== Bench Crafts for ${args.item_class} at item level ${args.item_level} ===`,
      "",
      "PoB table candidates only: this does not verify craft unlocks, existing affix conflicts, special item rules or the current game version.",
      "A craft occupies a slot of its own type, so a prefix craft cannot fill an open suffix.",
      "",
      `Within item level (${result.mods.length}):`,
      ...render(result.mods),
      "",
      ...(result.lockedByItemLevel.length
        ? [`Locked by item level (${result.lockedByItemLevel.length}); availability is not verified:`, ...render(result.lockedByItemLevel)]
        : []),
    ]);
  });
}

export async function handleFindAffixTiers(args: {
  search: string;
  affix_type?: string;
  slot_tags?: string[];
  item_tags?: string[];
  item_tags_complete?: boolean;
  max_item_level?: number;
  include_unobtainable?: boolean;
  max_results?: number;
}) {
  return wrapHandler("find affix tiers", async () => {
    if (!args.search) throw new Error("search was empty. Pass the stat wording you need, e.g. 'Chaos Resistance'.");
    if (args.item_tags !== undefined && (!Array.isArray(args.item_tags) || args.item_tags.length < 1 || args.item_tags.length > 128 ||
      args.item_tags.some(tag => typeof tag !== 'string' || !/^[a-z0-9_]+$/.test(tag)) || !args.item_tags.includes('default') || args.item_tags_complete !== true || args.slot_tags?.length)) {
      throw new Error('item_tags must be a confirmed complete tag set including default; do not combine it with slot_tags');
    }
    if (args.item_tags_complete === true && args.item_tags === undefined) throw new Error('item_tags_complete requires item_tags');

    const result = findAffixTiers({
      search: args.search,
      affixType: affixType(args.affix_type),
      slotTags: args.slot_tags,
      itemTags: args.item_tags,
      maxItemLevel: args.max_item_level,
      includeUnobtainable: args.include_unobtainable ?? false,
      limit: args.max_results ?? 10,
    });

    if (!result.groups.length) {
      const suggestions = args.slot_tags?.length
        ? result.knownSlotTags.filter((tag) => args.slot_tags?.some((wanted) => tag.includes(wanted.toLowerCase())))
        : [];
      return text([
        `No affix data matched "${args.search}"${args.slot_tags?.length ? ` for positive-weight tags ${args.slot_tags.join(", ")}` : ""}.`,
        ...(suggestions.length ? ["", `Related base tags in the data: ${suggestions.join(", ")}`] : []),
        "",
        "Base tags are PoB's own vocabulary, not slot names. Body armour bases carry str_armour / dex_armour / int_armour and their hybrids; influenced variants add a suffix such as _elder.",
      ]);
    }

    const body = result.groups.flatMap((group) => [
      `${group.type} — ${group.group}`,
      ...group.tiers.map(
        (tier) =>
          `  ilvl ${tier.level} "${tier.affix}" ${tier.statLines.join(" / ")} [id: ${tier.id}]` +
          `${tier.statLines.length > 1 ? " (hybrid: one affix)" : ""}` +
          `\n      positive-weight tags: ${tier.slotTags.length ? tier.slotTags.join(", ") : "none"}` +
          (args.item_tags ? `\n      first matching base spawn rule: ${(() => { const rule = firstMatchingSpawnRule(tier, args.item_tags!); return rule ? `${rule.tag} = ${rule.weight}` : 'none (base weight 0)'; })()}` : '')
      ),
      "",
    ]);

    return text([
      `=== Affix Tiers matching "${args.search}" ===`,
      "",
      `${result.groups.length} of ${result.totalGroups} matching affix groups. ilvl is the minimum item level.`,
      'Entries are ordered by required item level. T1/T2 labels are not inferred from result order; these tables provide no authoritative tier-number field.',
      'Positive-weight tags are not proof an item can roll a modifier: earlier matching zero-weight rules, multipliers, influence, item state, mod conflicts and crafting method can change eligibility. Elevated modifiers can have zero base weights overridden by PoB for influence; such candidates are retained for inspection. Base rules are not probabilities.',
      ...(args.item_tags ? ['First-match results depend on the caller-supplied complete tag set; modifiers and crafting mechanics are not validated.'] : []),
      "",
      ...body,
    ]);
  });
}
