import { createSnapshotSummaryTool } from '../../src/features/buildSummary/tool.js';
import type { BuildEngine, BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64);
function setup(overrides: Record<string, unknown> = {}) {
  const engine = { getBuildInfo: jest.fn().mockResolvedValue({ level: 90 }), getStats: jest.fn().mockResolvedValue({ Life: 0, MinionCombinedDPS: 150 }), getSkills: jest.fn().mockResolvedValue({ mainSocketGroup: 2, groups: [{ index: 2, enabled: true }] }), getTree: jest.fn().mockResolvedValue({ treeVersion: '3_29', nodes: [42], masteryEffects: {} }), getItems: jest.fn().mockResolvedValue([{ slot: 'Amulet', id: 1, shown: true, raw: 'item text' }, { slot: 'Ring 1', id: 0, shown: true }]), getConfig: jest.fn().mockResolvedValue({ enemyIsBoss: 'Pinnacle' }), queryTreePaths: jest.fn().mockResolvedValue({ mode: 'allocated', treeVersion: '3_29', nodes: [{ id: 42, name: 'Keystone', nameKnown: true, type: 'keystone', allocated: true, stats: [] }], missingIds: [] }), ...overrides };
  const runReadOnlySnapshot = jest.fn(async (_id: string, fn: (value: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: { engineVersion: '1' }, warnings: [], result: await fn(engine as unknown as BuildEngine) }));
  return { engine, runReadOnlySnapshot, tool: createSnapshotSummaryTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>) };
}
it('keeps selected skill and minion metrics, node identity, real zeroes and optional item text', async () => {
  const test = setup(), args = { snapshot_id: id, fields: ['Life', 'MinionCombinedDPS'] };
  const result = JSON.parse((await test.tool.invoke(args)).content[0].text);
  expect(result.status).toBe('complete'); expect(result.metrics.Life.value).toBe(0); expect(result.metrics.MinionCombinedDPS.value).toBe(150);
  expect(result.sections.skills.value.mainSocketGroup).toBe(2); expect(result.sections.allocatedNodeDetails.value.nodes[0]).toMatchObject({ id: 42, type: 'keystone' });
  expect(result.sections.items.value).toEqual([{ slot: 'Amulet', id: 1, shown: true }]);
  expect(test.engine.queryTreePaths).toHaveBeenCalledWith({ allocatedOnly: true });
  const expanded = JSON.parse((await test.tool.invoke({ ...args, include_item_text: true })).content[0].text);
  expect(expanded.sections.items.value[0].raw).toBe('item text');
});
it('reports missing metrics and failed sections without inventing zeroes', async () => {
  const test = setup({ getItems: jest.fn().mockRejectedValue(new Error('item read failed')) });
  const result = JSON.parse((await test.tool.invoke({ snapshot_id: id, fields: ['Life', 'UnknownMetric'] })).content[0].text);
  expect(result.status).toBe('partial'); expect(result.metrics.UnknownMetric).toEqual({ status: 'unknown', value: null });
  expect(result.sections.items).toEqual({ status: 'unavailable', reason: 'item read failed' });
  expect(result.unavailableSections).toContain('items');
});
it('rejects inconsistent allocated node data and malformed options', async () => {
  const test = setup({ queryTreePaths: jest.fn().mockResolvedValue({ mode: 'allocated', treeVersion: '3_28', nodes: [], missingIds: [] }) });
  const result = JSON.parse((await test.tool.invoke({ snapshot_id: id, fields: ['Life'] })).content[0].text);
  expect(result.status).toBe('partial'); expect(result.sections.allocatedNodeDetails.status).toBe('unavailable');
  await expect(test.tool.invoke({ snapshot_id: id, fields: ['Life', 'Life'] })).rejects.toThrow('Invalid');
  expect(test.runReadOnlySnapshot).toHaveBeenCalledTimes(1);
});
it('marks unresolved node names and missing node IDs as partial', async () => {
  const test = setup({ queryTreePaths: jest.fn().mockResolvedValue({ mode: 'allocated', treeVersion: '3_29', nodes: [{ id: 42, name: 'Unnamed', nameKnown: false, type: 'normal', allocated: true, stats: [] }], missingIds: [] }) });
  const result = JSON.parse((await test.tool.invoke({ snapshot_id: id, fields: ['Life'] })).content[0].text);
  expect(result.status).toBe('partial'); expect(result.unresolvedNodeIds).toEqual([42]);
});
