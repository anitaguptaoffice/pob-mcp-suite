import { createSnapshotAilmentsTool } from '../../src/features/ailments/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

it('distinguishes uncredited, unknown and credited effects without modifying inputs', async () => {
  const ailments = [
    { name: 'Shock', chanceOnHit: 10, chanceOnCrit: 0, appliedEffect: 0, calculatedEffect: 12, creditedInCalc: false, landsOnConfiguredEnemy: true },
    { name: 'Chill', chanceOnHit: 1, chanceOnCrit: 0, appliedEffect: 0, creditedInCalc: false },
    { name: 'Scorch', chanceOnHit: 1, chanceOnCrit: 0, appliedEffect: 10, creditedInCalc: true },
  ];
  const runReadOnlySnapshot = jest.fn(async (_id, run) => ({ snapshotId: 'a'.repeat(64), identity: {}, warnings: [], result: await run({ getAilments: async () => ({ ailments, calculationSelectionMatchesMain: true }), getConfig: async () => ({ enemyLevel: 84 }), getSkills: async () => ({ mainSocketGroup: 1 }) }) }));
  const tool = createSnapshotAilmentsTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: 'a'.repeat(64) })).content[0].text);
  expect(result.uncredited).toEqual(['Shock']); expect(result.unknown).toEqual(['Chill']);
  expect(result.ailments).toEqual(ailments); expect(result.config.enemyLevel).toBe(84);
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Invalid');
  expect(runReadOnlySnapshot).toHaveBeenCalledTimes(1);
});

it('withholds estimates from a different calculation skill', async () => {
  const runReadOnlySnapshot = async (_id: string, run: any) => ({ snapshotId: 'a'.repeat(64), identity: {}, warnings: [], result: await run({ getAilments: async () => ({ ailments: [{ name: 'Shock', chanceOnHit: 10, chanceOnCrit: 0, appliedEffect: 0, calculatedEffect: 20, creditedInCalc: false, landsOnConfiguredEnemy: true, thresholdTable: [{ effect: 20 }] }], calculationSelectionMatchesMain: false }), getConfig: async () => ({}), getSkills: async () => ({}) }) });
  const tool = createSnapshotAilmentsTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: 'a'.repeat(64) })).content[0].text);
  expect(result.ailments[0].calculatedEffect).toBeUndefined(); expect(result.ailments[0].thresholdTable).toBeUndefined();
  expect(result.uncredited).toEqual([]); expect(result.unknown).toEqual(['Shock']);
});
