import { createEquipmentAnalysisTool } from '../../src/features/equipmentAnalysis/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64);
function fixture() {
  const engine = {
    listItemSets: async () => ({ activeItemSetId: 2, itemSets: [{ id: 1, title: 'Old', active: false, useSecondWeaponSet: false }, { id: 2, title: 'Active', active: true, useSecondWeaponSet: true }] }),
    getItems: async () => [
      { slot: 'Weapon 1', id: 1, shown: true, name: 'Old Weapon', raw: 'old' },
      { slot: 'Weapon 1 Swap', id: 2, shown: true, name: 'Active Weapon', raw: 'active' },
      { slot: 'Ring 1', id: 3, shown: true, baseName: 'Gold Ring', raw: 'ring' },
      { slot: 'Ring 2', id: 4, shown: true },
      { slot: 'Ring 3', id: 0, shown: false },
      { slot: 'Gloves', id: 0 },
      { slot: 'Boots', id: 0, shown: true },
    ],
    getTree: async () => ({ className: 'Witch', ascendClassName: 'Necromancer', treeVersion: '3_29' }),
    getStats: async () => ({ Life: 1, EnergyShield: 5000, MinionCombinedDPS: 1000, ChaosResist: 0 }),
    getSkills: async () => ({ mainSocketGroup: 1 }), getConfig: async () => ({ enemyIsBoss: true }),
  };
  const foundation = { runReadOnlySnapshot: async (_id: string, fn: (engine: unknown) => Promise<unknown>) => ({ snapshotId: id, identity: {}, warnings: [], result: await fn(engine) }) } as unknown as BuildFoundation;
  return { tool: createEquipmentAnalysisTool(foundation), engine };
}

it('separates active observations from explicitly unverified heuristic suggestions', async () => {
  const { tool } = fixture();
  const report = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(report.activeItemSet.id).toBe(2); expect(report.tree.ascendancy).toBe('Necromancer');
  expect(report.metrics.Life).toEqual({ status: 'available', value: 1 });
  expect(report.metrics.ChaosResist).toEqual({ status: 'available', value: 0 });
  expect(report.metrics.FireResist).toEqual({ status: 'unknown', value: null });
  expect(report.metrics.MinionCombinedDPS.value).toBe(1000); expect(report.config.enemyIsBoss).toBe(true);
  expect(report.slots.find((slot: any) => slot.slot === 'Weapon 1').inUse).toBe(false);
  expect(report.slots.find((slot: any) => slot.slot === 'Weapon 1 Swap').inUse).toBe(true);
  expect(report.slots.find((slot: any) => slot.slot === 'Ring 1').item.raw).toBeNull();
  expect(report.heuristic.status).toBe('unverified');
  const analyzed = report.heuristic.result.slotAnalysis;
  expect(analyzed.some((slot: any) => slot.slot === 'Weapon 1 Swap')).toBe(true);
  expect(analyzed.find((slot: any) => slot.slot === 'Ring 1').issues).not.toContain('Slot is empty');
  expect(analyzed.find((slot: any) => slot.slot === 'Boots').issues).toContain('Slot is empty');
  expect(analyzed.some((slot: any) => ['Ring 2', 'Ring 3', 'Gloves', 'Weapon 1'].includes(slot.slot))).toBe(false);
});

it('honors exact slot selection and rejects unrecognized slots', async () => {
  const { tool } = fixture();
  const report = JSON.parse((await tool.invoke({ snapshot_id: id, slot: 'Ring 1', include_item_text: true })).content[0].text);
  expect(report.slots).toHaveLength(1); expect(report.slots[0].item.raw).toBe('ring');
  await expect(tool.invoke({ snapshot_id: id, slot: 'invalid' })).rejects.toThrow('slot is unavailable');
});
