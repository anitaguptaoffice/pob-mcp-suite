import { createAnointmentTool } from '../../src/features/anointment/tool.js';
import type { BuildEngine, BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64);
const native = { slot: 'Amulet', enchantSlot: 1, selectedEnchant: 'Allocates Previous', baseType: 'Amulet', focus: 'dps', evaluated: 2, skipped: 1, base: { CombinedDPS: 500, TotalEHP: 1000, damageStat: 'MinionCombinedDPS', damageValue: 100, ehpAvailable: true }, candidates: [{ nodeId: 42, name: 'Example', dpsDelta: 20, ehpDelta: 5, score: 20, recipe: ['Clear Oil'] }] };
function setup(value: unknown = native) {
  const evaluateAnointCandidates = jest.fn().mockResolvedValue(value);
  const runReadOnlySnapshot = jest.fn(async (_id: string, fn: (engine: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: {}, warnings: [], result: await fn({ evaluateAnointCandidates } as unknown as BuildEngine) }));
  return { evaluateAnointCandidates, runReadOnlySnapshot, tool: createAnointmentTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>) };
}
const args = { snapshot_id: id, slot: 'Amulet', focus: 'dps', damage_metric: 'MinionCombinedDPS' };
it('uses the explicit minion metric and reports the un-anointed baseline and skipped count', async () => {
  const test = setup(), result = JSON.parse((await test.tool.invoke(args)).content[0].text);
  expect(test.evaluateAnointCandidates).toHaveBeenCalledWith({ slot: 'Amulet', focus: 'dps', enchantSlot: 1, limit: 10, damageMetric: 'MinionCombinedDPS' });
  expect(result.baseline).toMatchObject({ kind: 'item_without_selected_enchantment', removedEnchant: 'Allocates Previous', damageMetric: 'MinionCombinedDPS', damageValue: 100 });
  expect(result.candidates[0].dpsDelta).toBe(20); expect(result.skipped).toBe(1);
});
it('rejects ambiguous metrics and inconsistent PoB results', async () => {
  const test = setup();
  await expect(test.tool.invoke({ ...args, damage_metric: undefined })).rejects.toThrow('Invalid anointment');
  await expect(test.tool.invoke({ ...args, focus: 'defence' })).rejects.toThrow('Invalid anointment');
  expect(test.runReadOnlySnapshot).not.toHaveBeenCalled();
  const mismatch = setup({ ...native, base: { ...native.base, damageStat: 'CombinedDPS' } });
  await expect(mismatch.tool.invoke(args)).rejects.toThrow('invalid anointment results');
});
it('does not invent effective hit pool when PoB did not provide it', async () => {
  const test = setup({ ...native, base: { ...native.base, TotalEHP: 0, ehpAvailable: false } });
  const result = JSON.parse((await test.tool.invoke(args)).content[0].text);
  expect(result.baseline.totalEhp).toBeNull(); expect(result.candidates[0].ehpDelta).toBeNull();
});
it('forwards an explicit enchant slot and identifies the enchantment used for the baseline', async () => {
  const test = setup({ ...native, enchantSlot: 2, selectedEnchant: 'Another enchantment' });
  const result = JSON.parse((await test.tool.invoke({ ...args, enchant_slot: 2 })).content[0].text);
  expect(test.evaluateAnointCandidates).toHaveBeenCalledWith(expect.objectContaining({ enchantSlot: 2 }));
  expect(result.baseline).toMatchObject({ enchantSlot: 2, removedEnchant: 'Another enchantment' });
});
