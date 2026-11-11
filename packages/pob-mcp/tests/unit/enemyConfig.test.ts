import { createEnemyConfigTool } from '../../src/features/enemyConfig/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64), child = 'b'.repeat(64);
function setup() {
  const inspect = jest.fn().mockResolvedValue({ snapshotId: id, identity: {}, warnings: [], data: { config: { enemyLevel: 84, enemyFireResist: 40 } } });
  const deriveExactConfig = jest.fn().mockResolvedValue({ snapshot: { id: child, parentId: id, xml: '<secret/>' }, changedKeys: ['enemyLevel', 'enemyFireResist'] });
  const evaluate = jest.fn().mockRejectedValue(new Error('calculation unavailable'));
  return { inspect, deriveExactConfig, evaluate, tool: createEnemyConfigTool({ inspect, deriveExactConfig, evaluate } as unknown as Pick<BuildFoundation, 'inspect' | 'evaluate' | 'deriveExactConfig'>) };
}
it('maps explicit enemy fields and reports missing prior values without inventing defaults', async () => {
  const test = setup(), result = JSON.parse((await test.tool.invoke({ snapshot_id: id, enemy: { level: 65, fire_resist: 0, armor: 100 }, compare: false, trial: true })).content[0].text);
  expect(test.deriveExactConfig).toHaveBeenCalledWith(id, { enemyLevel: 65, enemyFireResist: 0, enemyArmour: 100 }, true, { mode: 'explicit', value: 65 });
  expect(result.previous).toEqual({ level: 84, fire_resist: 40, armor: null });
  expect(result.snapshot).toMatchObject({ id: child, parentId: id }); expect(result.snapshot.xml).toBeUndefined();
  expect(result.comparisonStatus).toBe('not_requested');
});
it('preserves the created snapshot when the optional damage comparison fails', async () => {
  const test = setup(), result = JSON.parse((await test.tool.invoke({ snapshot_id: id, enemy: { level: 65 } })).content[0].text);
  expect(result.comparisonStatus).toBe('error'); expect(result.comparisonError).toBe('calculation unavailable'); expect(result.snapshot.id).toBe(child);
});
it('rejects invalid values and malformed options before opening PoB', async () => {
  const test = setup();
  for (const enemy of [{}, { level: 0 }, { level: 1.5 }, { armor: -1 }, { fire_resist: NaN }, { unsupported: 1 }]) await expect(test.tool.invoke({ snapshot_id: id, enemy })).rejects.toThrow('Invalid');
  await expect(test.tool.invoke({ snapshot_id: id, enemy: { level: 60 }, compare: false, fields: ['Life'] })).rejects.toThrow('Invalid');
  expect(test.inspect).not.toHaveBeenCalled();
});
