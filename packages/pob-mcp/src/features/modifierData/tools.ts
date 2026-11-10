import type { ModifierDataFile, ModifierDataSource, AffixSlot } from '../../ports/modifierData.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { resolveAffixes } from '../../services/affixMatcher.js';
import { findAffixTiers, findCraftableMods, firstMatchingSpawnRule } from '../../services/affixQuery.js';

const info = (file: ModifierDataFile) => ({ source: 'pob_modifier_table', fileName: file.fileName, sha256: file.sha256 });
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const int = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const validSlot = (value: unknown) => value === undefined || value === 'Prefix' || value === 'Suffix';
const validTags = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(tag => typeof tag === 'string' && /^[a-z0-9_]{1,100}$/.test(tag)) && new Set(value).size === value.length;
const warning = 'PoB table matches are not proof of current game availability, item legality or crafting probability.';

export function modifierDataSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'classify_modifier_lines', description: 'Classify explicit lines against versioned PoB tables; slot counts require confirmed rarity, complete lines and ordinary capacity.', inputSchema: { type: 'object', additionalProperties: false, properties: { mod_lines: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string' } }, rarity: { type: 'string', enum: ['rare', 'magic'] }, explicit_mods_complete: { type: 'boolean' }, ordinary_capacity_confirmed: { type: 'boolean' } }, required: ['mod_lines'] } },
    { name: 'query_bench_modifiers', description: 'Query PoB bench table candidates by item class, level and optional affix type; does not establish unlocks or crafting legality.', inputSchema: { type: 'object', additionalProperties: false, properties: { item_class: { type: 'string' }, item_level: { type: 'integer', minimum: 1, maximum: 1000 }, affix_type: { type: 'string', enum: ['Prefix', 'Suffix'] }, search: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['item_class', 'item_level'] } },
    { name: 'query_modifier_tiers', description: 'Query PoB explicit modifier tiers; broad tags or a caller-confirmed complete tag set are distinct from crafting probability.', inputSchema: { type: 'object', additionalProperties: false, properties: { search: { type: 'string' }, affix_type: { type: 'string', enum: ['Prefix', 'Suffix'] }, slot_tags: { type: 'array', items: { type: 'string' } }, item_tags: { type: 'array', items: { type: 'string' } }, item_tags_complete: { type: 'boolean' }, max_item_level: { type: 'integer', minimum: 1, maximum: 1000 }, include_unobtainable: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['search'] } },
  ];
}
export function createModifierDataTools(source: ModifierDataSource): FeatureTool[] {
  const [classify, bench, tiers] = modifierDataSchemas();
  return [
    { schema: classify, invoke: async args => {
      if (Object.keys(args).some(k => !['mod_lines', 'rarity', 'explicit_mods_complete', 'ordinary_capacity_confirmed'].includes(k)) || !Array.isArray(args.mod_lines) || args.mod_lines.length < 1 || args.mod_lines.length > 30 || args.mod_lines.some(line => typeof line !== 'string' || !line.trim() || line.length > 500) || (args.rarity !== undefined && !['rare', 'magic'].includes(args.rarity as string)) || (args.explicit_mods_complete !== undefined && typeof args.explicit_mods_complete !== 'boolean') || (args.ordinary_capacity_confirmed !== undefined && typeof args.ordinary_capacity_confirmed !== 'boolean')) throw new Error('Invalid modifier classification options');
      const explicit = source.readExplicit(), master = source.readMaster();
      const resolution = resolveAffixes(args.mod_lines as string[], [...explicit.entries, ...master.entries]);
      const capacity = args.rarity === 'rare' ? 3 : args.rarity === 'magic' ? 1 : null;
      const certain = capacity !== null && args.explicit_mods_complete === true && args.ordinary_capacity_confirmed === true && resolution.openPrefixes !== null && resolution.openSuffixes !== null && resolution.prefixCount <= capacity && resolution.suffixCount <= capacity;
      return json({ source: [info(explicit), info(master)], resolution: { ...resolution, openPrefixes: certain ? capacity - resolution.prefixCount : null, openSuffixes: certain ? capacity - resolution.suffixCount : null }, assumptions: { rarity: args.rarity ?? null, explicitModsComplete: args.explicit_mods_complete === true, ordinaryCapacityConfirmed: args.ordinary_capacity_confirmed === true }, warnings: [warning, 'Slot counts are unknown unless all explicit lines, rarity and ordinary capacity are confirmed and matches are unambiguous.', ...resolution.warnings] });
    } },
    { schema: bench, invoke: async args => {
      const offset = args.offset ?? 0, limit = args.limit ?? 50;
      if (Object.keys(args).some(k => !['item_class', 'item_level', 'affix_type', 'search', 'offset', 'limit'].includes(k)) || typeof args.item_class !== 'string' || !args.item_class.trim() || args.item_class.length > 100 || !int(args.item_level, 1, 1000) || !validSlot(args.affix_type) || (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 200)) || !int(offset, 0, 1000000) || !int(limit, 1, 100)) throw new Error('Invalid bench modifier query');
      const file = source.readMaster(), result = findCraftableMods({ itemClass: args.item_class, itemLevel: args.item_level as number, affixType: args.affix_type as AffixSlot | undefined, search: args.search as string | undefined }, file.entries);
      const combined = [...result.mods.map(mod => ({ ...mod, withinItemLevel: true })), ...result.lockedByItemLevel.map(mod => ({ ...mod, withinItemLevel: false }))];
      const page = combined.slice(offset as number, (offset as number) + (limit as number));
      return json({ source: info(file), query: args, total: combined.length, withinItemLevel: result.mods.length, lockedByItemLevel: result.lockedByItemLevel.length, offset, nextOffset: (offset as number) + page.length < combined.length ? (offset as number) + page.length : null, mods: page, knownItemClasses: result.knownItemClasses, warnings: [warning, 'Bench data does not check unlocks, existing affix conflicts, special item rules or available slots.'] });
    } },
    { schema: tiers, invoke: async args => {
      if (Object.keys(args).some(k => !['search', 'affix_type', 'slot_tags', 'item_tags', 'item_tags_complete', 'max_item_level', 'include_unobtainable', 'offset', 'limit'].includes(k)) || typeof args.search !== 'string' || !args.search.trim() || args.search.length > 200 || !validSlot(args.affix_type) || (args.slot_tags !== undefined && !validTags(args.slot_tags)) || (args.item_tags !== undefined && (!validTags(args.item_tags) || !args.item_tags.includes('default') || args.item_tags_complete !== true || args.slot_tags !== undefined)) || (args.item_tags_complete !== undefined && typeof args.item_tags_complete !== 'boolean') || (args.item_tags_complete === true && args.item_tags === undefined) || (args.max_item_level !== undefined && !int(args.max_item_level, 1, 1000)) || (args.include_unobtainable !== undefined && typeof args.include_unobtainable !== 'boolean') || (args.offset !== undefined && !int(args.offset, 0, 1000000)) || (args.limit !== undefined && !int(args.limit, 1, 100))) throw new Error('Invalid modifier tier query');
      const file = source.readExplicit(), itemTags = args.item_tags as string[] | undefined;
      const offset = (args.offset ?? 0) as number;
      const result = findAffixTiers({ search: args.search, affixType: args.affix_type as AffixSlot | undefined, slotTags: args.slot_tags as string[] | undefined, itemTags, maxItemLevel: args.max_item_level as number | undefined, includeUnobtainable: args.include_unobtainable as boolean | undefined, offset, limit: (args.limit ?? 10) as number }, file.entries);
      return json({ source: info(file), query: args, ...result, offset, nextOffset: offset + result.groups.length < result.totalGroups ? offset + result.groups.length : null, groups: result.groups.map(group => ({ ...group, tiers: group.tiers.map(tier => ({ ...tier, firstMatchingBaseRule: itemTags ? firstMatchingSpawnRule(tier, itemTags) ?? null : null })) })), warnings: [warning, 'Broad tags match any listed tag. A first-matching base rule requires a complete confirmed tag set and excludes multipliers, influence overrides, conflicts and crafting mechanics.', 'Entries are ordered by item level; authoritative tier numbers are not inferred.'] });
    } },
  ];
}
