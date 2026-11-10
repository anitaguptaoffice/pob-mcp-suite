import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { EconomySource } from '../../ports/economySource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { estimateObservedCost, type ObservedCostResult } from '../buildCost/snapshotTool.js';

type Row = { slot: string; id: number; shown?: boolean; name?: string; baseName?: string; rarity?: string; raw?: string; active?: boolean };
export function shoppingListSchema(): FeatureTool['schema'] {
  return { name: 'list_snapshot_equipment', description: 'List the snapshot active equipment set and optional poe.ninja reference estimates. Prices are not purchasable listings; use a securable priced Trade search separately.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, league: { type: 'string' }, include_reference: { type: 'boolean' } }, required: ['snapshot_id', 'league'] } };
}

export function createShoppingListTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, economy: EconomySource): FeatureTool {
  return { schema: shoppingListSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'league', 'include_reference'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 || (args.include_reference !== undefined && typeof args.include_reference !== 'boolean')) throw new Error('Valid snapshot ID and exact international league are required');
    const league = args.league.trim(), includeReference = args.include_reference === true;
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => ({ sets: await engine.listItemSets(), items: await engine.getItems(), ...(includeReference ? { skills: await engine.getSkills() } : {}) }));
    const { sets } = result;
    if (!sets || !Number.isSafeInteger(sets.activeItemSetId) || sets.activeItemSetId < 1 || !Array.isArray(sets.itemSets) || !sets.itemSets.length || sets.itemSets.some(set => !Number.isSafeInteger(set.id) || set.id < 1 || typeof set.title !== 'string' || typeof set.active !== 'boolean' || typeof set.useSecondWeaponSet !== 'boolean') || new Set(sets.itemSets.map(set => set.id)).size !== sets.itemSets.length || sets.itemSets.filter(set => set.active).length !== 1 || !sets.itemSets.some(set => set.id === sets.activeItemSetId && set.active)) throw new Error('PoB returned invalid active item set');
    if (!Array.isArray(result.items) || result.items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.slot !== 'string' || !item.slot.trim() || !Number.isSafeInteger(item.id) || item.id < 0 || (item.shown !== undefined && typeof item.shown !== 'boolean')) || new Set(result.items.map(item => item.slot)).size !== result.items.length) throw new Error('PoB returned invalid equipment slots');
    const activeSet = sets.itemSets.find(set => set.active)!;
    let reference: ObservedCostResult | null = null;
    if (includeReference) reference = await estimateObservedCost(economy, league, result.items, result.skills as { groups?: unknown } | undefined);
    const prices = new Map((reference?.entries ?? []).filter(entry => entry.kind === 'item').map(entry => [entry.slot, entry]));
    const slots = (result.items as Row[]).map(item => {
      const weapon = /^Weapon [12]( Swap)?$/i.exec(item.slot);
      const weaponSetActive = weapon ? Boolean(weapon[1]) === activeSet.useSecondWeaponSet : null;
      const visible = item.shown === undefined ? null : item.shown;
      const inUse = weaponSetActive === false || visible === false ? false : visible === null ? null : true;
      const state = item.id === 0 ? 'empty' : typeof item.raw === 'string' && item.raw.trim() && (item.name || item.baseName) ? 'equipped' : 'unresolved';
      const category = /jewel/i.test(item.slot) ? 'jewel' : /flask/i.test(item.slot) ? 'flask' : /weapon/i.test(item.slot) ? 'weapon' : 'equipment';
      return { slot: item.slot, category, inUse, visibility: visible, weaponSetActive, state, itemId: item.id,
        item: state === 'empty' ? null : { name: item.name ?? null, baseName: item.baseName ?? null, rarity: item.rarity ?? null, raw: item.raw ?? null },
        active: typeof item.active === 'boolean' ? item.active : null, reference: inUse === true ? prices.get(item.slot) ?? null : null, purchaseStatus: 'not_checked' };
    });
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, league, activeItemSet: activeSet, slots, reference,
      warnings: [...context.warnings, 'This is an equipment inventory, not an upgrade recommendation or complete shopping plan.', 'Each item is purchase-status unknown; reference estimates are not securable listings, and unavailable or unpriced items are not zero.', 'Inactive or hidden slots are reported separately; validate item legality and actual listing details before purchasing.'] }) }] };
  } };
}
