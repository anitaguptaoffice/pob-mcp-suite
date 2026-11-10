import { createCraftingContextTool } from '../../src/features/craftingContext/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { BaseReferenceSource } from '../../src/ports/baseReferenceSource.js';
const id = 'a'.repeat(64);
function setup(item: Record<string, unknown> = { slot: 'Helmet', id: 3, shown: true, baseName: 'Hubris Circlet', raw: 'Rarity: RARE' }) {
  const runReadOnlySnapshot = jest.fn(async (_id, run) => ({ snapshotId: id, warnings: [], result: await run({ getItems: async () => [item], listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, active: true, useSecondWeaponSet: false }] }), getStats: async () => ({ Life: 1, EnergyShield: 5000 }) }) }));
  const verify = jest.fn(async (base: string) => ({ source: 'poedb' as const, base, englishUrl: 'https://poedb.tw/us/example', chineseUrl: 'https://poedb.tw/cn/example' }));
  return { runReadOnlySnapshot, verify, tool: createCraftingContextTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>, { verify } as BaseReferenceSource) };
}
it('uses only the visible active equipped base and does not request external data by default', async () => {
  const t = setup(), result = JSON.parse((await t.tool.invoke({ snapshot_id: id, slot: 'Helmet', desired_mods: ['life'] })).content[0].text);
  expect(result.base).toBe('Hubris Circlet'); expect(result.baseSource).toBe('equipped'); expect(result.buildStats.EnergyShield).toBe(5000);
  expect(result.reference.status).toBe('not_requested'); expect(t.verify).not.toHaveBeenCalled();
});
it('permits an explicit base without a snapshot and reports verification failure accurately', async () => {
  const t = setup(); t.verify.mockRejectedValueOnce(new Error('network unavailable'));
  const result = JSON.parse((await t.tool.invoke({ slot: 'Helmet', base: 'Other', verify_base: true })).content[0].text);
  expect(result.baseSource).toBe('provided'); expect(result.reference.status).toBe('unavailable'); expect(t.runReadOnlySnapshot).not.toHaveBeenCalled();
});
it('rejects inactive, hidden and unresolved bases and invalid options before lookup', async () => {
  const t = setup({ slot: 'Weapon 1 Swap', id: 2, shown: true, baseName: 'Sword' });
  await expect(t.tool.invoke({ snapshot_id: id, slot: 'Weapon 1 Swap' })).rejects.toThrow('visible, active');
  await expect(t.tool.invoke({ slot: 'Helmet', base: 'x', item_level: 101, verify_base: true })).rejects.toThrow('Invalid');
  expect(t.verify).not.toHaveBeenCalled();
});
it('labels a supplied target base separately from the equipped item', async () => {
  const t = setup(), result = JSON.parse((await t.tool.invoke({ snapshot_id: id, slot: 'Helmet', base: 'Other', verify_base: true })).content[0].text);
  expect(result.baseSource).toBe('provided'); expect(result.equipped.baseName).toBe('Hubris Circlet');
  expect(result.reference.status).toBe('verified_title'); expect(t.verify).toHaveBeenCalledWith('Other');
});
