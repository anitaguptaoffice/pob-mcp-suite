import { normalizeEquipment } from '../../domain/equipment.js';
import { analyzeEquippedItems, isEquippableGearSlot, type BuildStats } from '../../domain/itemAnalysis.js';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { toFiniteNumber } from '../../utils/numbers.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const fields = ['Life', 'EnergyShield', 'Evasion', 'Armour', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'];
export function equipmentAnalysisSchema(): FeatureTool['schema'] {
  return { name: 'analyze_snapshot_equipment', description: 'Inspect the active equipment set and PoB context from one snapshot, with explicitly labeled legacy heuristic suggestions. No item gains, prices or legality are verified.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, slot: { type: 'string' }, include_item_text: { type: 'boolean' } }, required: ['snapshot_id'] } };
}

export function createEquipmentAnalysisTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: equipmentAnalysisSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'slot', 'include_item_text'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || (args.slot !== undefined && (typeof args.slot !== 'string' || !args.slot.trim() || args.slot !== args.slot.trim() || args.slot.length > 100)) || (args.include_item_text !== undefined && typeof args.include_item_text !== 'boolean')) throw new Error('Invalid equipment analysis options');
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => ({ sets: await engine.listItemSets(), items: await engine.getItems(), tree: await engine.getTree(), stats: await engine.getStats(fields), skills: await engine.getSkills(), config: await engine.getConfig() }));
    const { activeSet, slots } = normalizeEquipment(result.sets, result.items as Parameters<typeof normalizeEquipment>[1]);
    if (!result.stats || typeof result.stats !== 'object' || Array.isArray(result.stats) || !result.tree || typeof result.tree !== 'object' || Array.isArray(result.tree)) throw new Error('PoB returned invalid equipment analysis context');
    const tree = result.tree as { className?: unknown; ascendClassName?: unknown; treeVersion?: unknown };
    if ([tree.className, tree.ascendClassName, tree.treeVersion].some(value => value !== undefined && value !== null && typeof value !== 'string')) throw new Error('PoB returned invalid tree identity');
    const metrics = Object.fromEntries(fields.map(field => {
      const raw = (result.stats as Record<string, unknown>)[field];
      const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? toFiniteNumber(raw) : undefined;
      return [field, value === undefined ? { status: 'unknown', value: null } : { status: 'available', value }];
    }));
    const selected = args.slot === undefined ? slots : slots.filter(item => item.slot === args.slot);
    if (args.slot !== undefined && selected.length !== 1) throw new Error('Requested equipment slot is unavailable');
    const heuristicSlot = (slot: string) => slot.replace(/^(Weapon [12]) Swap$/i, '$1');
    const usable = selected.filter(item => item.inUse === true && item.state !== 'unresolved' && isEquippableGearSlot(heuristicSlot(item.slot)));
    const mappings: Record<string, keyof BuildStats> = { Life: 'life', EnergyShield: 'energyShield', Evasion: 'evasion', Armour: 'armour', TotalDPS: 'dps', FireResist: 'fireRes', ColdResist: 'coldRes', LightningResist: 'lightningRes', ChaosResist: 'chaosRes' };
    const stats: BuildStats = {};
    for (const [name, key] of Object.entries(mappings)) if (metrics[name].status === 'available') stats[key] = metrics[name].value as number;
    const heuristic = analyzeEquippedItems(usable.map(row => ({ slot: heuristicSlot(row.slot), name: row.item?.name || row.item?.baseName || undefined, baseName: row.item?.baseName ?? undefined, rarity: row.item?.rarity ?? undefined, shown: row.visibility ?? undefined })), typeof tree.className === 'string' ? tree.className : undefined, typeof tree.ascendClassName === 'string' ? tree.ascendClassName : undefined, stats);
    for (const analysis of heuristic.slotAnalysis) analysis.slot = usable.find(row => heuristicSlot(row.slot) === analysis.slot)?.slot ?? analysis.slot;
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, activeItemSet: activeSet, tree: { className: tree.className ?? null, ascendancy: tree.ascendClassName ?? null, treeVersion: tree.treeVersion ?? null }, skills: result.skills, config: result.config, metrics,
      slots: selected.map(row => ({ ...row, item: row.item && args.include_item_text !== true ? { ...row.item, raw: null } : row.item })),
      heuristic: { status: 'unverified', scope: args.slot === undefined ? 'supported_visible_resolved_active_slots' : 'selected_supported_visible_resolved_active_slot', excludedSlots: selected.filter(item => item.inUse !== true || item.state === 'unresolved' || !isEquippableGearSlot(heuristicSlot(item.slot))).map(item => ({ slot: item.slot, state: item.state, inUse: item.inUse, reason: item.inUse === false ? 'inactive_or_hidden' : item.inUse === null ? 'visibility_unknown' : item.state === 'unresolved' ? 'unresolved' : 'unsupported_by_legacy_heuristic' })), result: heuristic },
      warnings: [...context.warnings, 'Equipment and metrics are PoB observations; the separate legacy heuristic may be outdated or incorrect, including resistance caps, archetypes and slot suggestions.', 'Hidden, inactive, unresolved, visibility-unknown and unsupported slots are excluded from the heuristic, not treated as empty.', 'Player and minion damage can overlap. Suggestions do not establish replacement gains, in-game legality, availability or price.'] }) }] };
  } };
}
