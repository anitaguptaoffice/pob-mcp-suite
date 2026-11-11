import { createShoppingListTool } from '../../src/features/shoppingList/tool.js';
import type { BuildEngine, BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { EconomySource } from '../../src/ports/economySource.js';
const snapshot = 'a'.repeat(64);
const sets = { activeItemSetId: 2, itemSets: [{ id: 1, title: 'old', active: false, useSecondWeaponSet: false }, { id: 2, title: 'current', active: true, useSecondWeaponSet: true }] };
const items = [
  { slot: 'Weapon 1', id: 1, shown: true, name: 'Goldrim', baseName: 'Leather Cap', raw: 'Rarity: UNIQUE\nGoldrim\nLeather Cap', rarity: 'UNIQUE' },
  { slot: 'Weapon 1 Swap', id: 2, shown: true, name: 'Current Sword', baseName: 'Sword', raw: 'current', rarity: 'RARE' },
  { slot: 'Helmet', id: 3, shown: true, name: 'Goldrim', baseName: 'Leather Cap', raw: 'Rarity: UNIQUE\nGoldrim\nLeather Cap', rarity: 'UNIQUE' },
  { slot: 'Ring 1', id: 0, shown: true }, { slot: 'Ring 3', id: 0, shown: false }, { slot: 'Gloves', id: 4, shown: true },
  { slot: 'Flask 1', id: 0, shown: true }, { slot: 'Jewel 1', id: 0, shown: true },
  { slot: 'Belt', id: 5, name: 'Goldrim', baseName: 'Leather Cap', raw: 'Rarity: UNIQUE\nGoldrim\nLeather Cap', rarity: 'UNIQUE' },
];
function setup() {
  const engine = { listItemSets: jest.fn().mockResolvedValue(sets), getItems: jest.fn().mockResolvedValue(items), getSkills: jest.fn().mockResolvedValue({ groups: [] }) } as unknown as BuildEngine;
  const runReadOnlySnapshot = jest.fn(async (id: string, fn: (engine: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: {}, warnings: [], result: await fn(engine) }));
  const read = jest.fn(async (query: { kind: string; league: string; category: string }) => ({ source: 'poe.ninja', query, fetchedAt: '2026-01-01T00:00:00Z', payload: { lines: query.category === 'UniqueArmour' ? [{ name: 'Goldrim', baseType: 'Leather Cap', chaosValue: 10, listingCount: 8 }] : [] } }));
  return { engine, runReadOnlySnapshot, read, tool: createShoppingListTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>, { read } as unknown as EconomySource) };
}
describe('snapshot equipment shopping list', () => {
  it('shows the selected item and weapon set, empty, hidden, jewel and unresolved slots without market calls', async () => {
    const test = setup(); const result = JSON.parse((await test.tool.invoke({ snapshot_id: snapshot, league: 'Standard' })).content[0].text);
    expect(result.activeItemSet).toMatchObject({ id: 2, useSecondWeaponSet: true });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Weapon 1')).toMatchObject({ inUse: false, weaponSetActive: false });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Weapon 1 Swap')).toMatchObject({ inUse: true, weaponSetActive: true, state: 'equipped', purchaseStatus: 'not_checked' });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Ring 3')).toMatchObject({ inUse: false, state: 'empty' });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Gloves').state).toBe('unresolved');
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Jewel 1').category).toBe('jewel');
    expect(result.reference).toBeNull(); expect(test.read).not.toHaveBeenCalled();
  });
  it('separates optional reference prices from buyable listings and leaves rare gear unpriced', async () => {
    const test = setup(); const result = JSON.parse((await test.tool.invoke({ snapshot_id: snapshot, league: 'Standard', include_reference: true })).content[0].text);
    expect(result.reference.complete).toBe(false);
    expect(result.reference.estimatedSubtotal).toBe(10);
    expect(result.reference.excludedItems).toEqual([{ slot: 'Weapon 1', itemId: 1, reason: 'inactive_or_hidden' }]);
    expect(result.reference.entries.find((entry: { slot: string }) => entry.slot === 'Belt')).toMatchObject({ status: 'unknown', note: expect.stringContaining('visibility is unknown') });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Helmet')).toMatchObject({ purchaseStatus: 'not_checked', reference: { status: 'reference', chaos: 10 } });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Weapon 1 Swap')).toMatchObject({ purchaseStatus: 'not_checked', reference: { status: 'unknown' } });
    expect(result.slots.find((slot: { slot: string }) => slot.slot === 'Ring 1').reference).toBeNull();
    expect(test.read).toHaveBeenCalledTimes(5);
  });
  it('rejects inconsistent active set or malformed input before market access', async () => {
    const test = setup();
    await expect(test.tool.invoke({ snapshot_id: snapshot, league: '' })).rejects.toThrow('exact international league');
    (test.engine.listItemSets as jest.Mock).mockResolvedValueOnce({ ...sets, activeItemSetId: 1 });
    await expect(test.tool.invoke({ snapshot_id: snapshot, league: 'Standard', include_reference: true })).rejects.toThrow('invalid active item set');
    expect(test.read).not.toHaveBeenCalled();
  });
});
