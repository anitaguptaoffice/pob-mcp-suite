import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { EconomySource } from '../../ports/economySource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { estimateObservedCost, type ObservedCostResult } from '../buildCost/snapshotTool.js';
import { normalizeEquipment } from '../../domain/equipment.js';

type Row = { slot: string; id: number; shown?: boolean; name?: string; baseName?: string; rarity?: string; raw?: string; active?: boolean };
export function shoppingListSchema(): FeatureTool['schema'] {
  return { name: 'list_snapshot_equipment', description: 'List the snapshot active equipment set and optional poe.ninja reference estimates. Prices are not purchasable listings; use a securable priced Trade search separately.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, league: { type: 'string' }, include_reference: { type: 'boolean' } }, required: ['snapshot_id', 'league'] } };
}

export function createShoppingListTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, economy: EconomySource): FeatureTool {
  return { schema: shoppingListSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'league', 'include_reference'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 || (args.include_reference !== undefined && typeof args.include_reference !== 'boolean')) throw new Error('Valid snapshot ID and exact international league are required');
    const league = args.league.trim(), includeReference = args.include_reference === true;
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => ({ sets: await engine.listItemSets(), items: await engine.getItems(), ...(includeReference ? { skills: await engine.getSkills() } : {}) }));
    const { activeSet, slots: normalized } = normalizeEquipment(result.sets, result.items as Row[]);
    let reference: ObservedCostResult | null = null;
    if (includeReference) reference = await estimateObservedCost(economy, league, result.sets, result.items, result.skills as { groups?: unknown } | undefined);
    const prices = new Map((reference?.entries ?? []).filter(entry => entry.kind === 'item').map(entry => [entry.slot, entry]));
    const slots = normalized.map(item => ({ ...item, reference: item.inUse === true ? prices.get(item.slot) ?? null : null, purchaseStatus: 'not_checked' }));
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, league, activeItemSet: activeSet, slots, reference,
      warnings: [...context.warnings, 'This is an equipment inventory, not an upgrade recommendation or complete shopping plan.', 'Each item is purchase-status unknown; reference estimates are not securable listings, and unavailable or unpriced items are not zero.', 'Inactive or hidden slots are reported separately; validate item legality and actual listing details before purchasing.'] }) }] };
  } };
}
