import { createJewelComparisonTool } from '../../src/features/jewelComparison/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64), child = 'b'.repeat(64);
function setup(allocated = true) {
  const engine = { getTree: async () => ({ nodes: allocated ? [10] : [] }), getItems: async () => [{ slot: 'Jewel 10', id: 1, raw: 'old' }],
    inspectItemParse: async (text: string) => ({ base: text === 'cluster' ? 'Large Cluster Jewel' : 'Cobalt Jewel', diagnostics: { available: true, unparsed: text === 'new' ? [{ line: 'unknown', extra: 'unknown' }] : [] } }) };
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ identity: {}, warnings: [], result: await callback(engine) }));
  const deriveItem = jest.fn().mockResolvedValue({ id: child, parentId: id, xml: '<secret/>' });
  const evaluate = jest.fn().mockResolvedValueOnce({ identity: {}, context: {}, warnings: [], metrics: {} }).mockRejectedValue(new Error('calculation unavailable'));
  const inspect = jest.fn();
  return { deriveItem, tool: createJewelComparisonTool({ runReadOnlySnapshot, deriveItem, evaluate, inspect } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveItem' | 'evaluate'>) };
}
it('keeps parse warnings and a created child ID if later comparison fails', async () => {
  const t = setup(), result = JSON.parse((await t.tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [{ name: 'new', item_text: 'new' }, { name: 'cluster', item_text: 'cluster' }] })).content[0].text);
  expect(t.deriveItem).toHaveBeenCalledWith(id, 'Jewel 10', 'new', true); expect(t.deriveItem).toHaveBeenCalledTimes(1);
  expect(result.results[0]).toMatchObject({ status: 'error', snapshot: { id: child }, error: 'calculation unavailable' });
  expect(result.results[0].snapshot.xml).toBeUndefined(); expect(result.results[0].parseDiagnostics.diagnostics.unparsed).toHaveLength(1);
  expect(result.results[1].error).toContain('not a supported ordinary jewel');
});
it('rejects unallocated sockets before trying any item', async () => {
  const t = setup(false);
  await expect(t.tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [{ name: 'new', item_text: 'new' }] })).rejects.toThrow('not allocated');
  expect(t.deriveItem).not.toHaveBeenCalled();
});
it('withholds deltas when calculation contexts differ', async () => {
  const engine = { getTree: async () => ({ nodes: [10] }), getItems: async () => [{ slot: 'Jewel 10', id: 0 }], inspectItemParse: async () => ({ base: 'Cobalt Jewel', diagnostics: { available: true, unparsed: [] } }) };
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ identity: {}, warnings: [], result: await callback(engine) }));
  const evaluate = jest.fn().mockResolvedValueOnce({ snapshotId: id, identity: {}, context: { config: { enemyLevel: 84 } }, warnings: [], metrics: { Life: { status: 'available', value: 100 } } })
    .mockResolvedValueOnce({ snapshotId: child, identity: {}, context: { config: { enemyLevel: 70 } }, warnings: [], metrics: { Life: { status: 'available', value: 200 } } });
  const deriveItem = jest.fn().mockResolvedValue({ id: child });
  const tool = createJewelComparisonTool({ runReadOnlySnapshot, deriveItem, evaluate } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveItem' | 'evaluate'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [{ name: 'test', item_text: 'x' }] })).content[0].text);
  expect(result.results[0].comparison.contextDifferent).toBe(true);
  expect(result.results[0].comparison.metrics.Life).toMatchObject({ status: 'incomparable', delta: null });
});
it('recognizes PoB default skill flags after reload without hiding real changes', async () => {
  const engine = { getTree: async () => ({ nodes: [10] }), getItems: async () => [{ slot: 'Jewel 10', id: 0 }], inspectItemParse: async () => ({ base: 'Cobalt Jewel', diagnostics: { available: true, unparsed: [] } }) };
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ identity: {}, warnings: [], result: await callback(engine) }));
  const evaluate = jest.fn().mockResolvedValueOnce({ snapshotId: id, identity: {}, context: { skills: { groups: [{}] } }, warnings: [], metrics: { Life: { status: 'available', value: 100 } } })
    .mockResolvedValueOnce({ snapshotId: child, identity: {}, context: { skills: { groups: [{ includeInFullDPS: false, mainActiveSkill: 1 }] } }, warnings: [], metrics: { Life: { status: 'available', value: 120 } } });
  const deriveItem = jest.fn().mockResolvedValue({ id: child });
  const tool = createJewelComparisonTool({ runReadOnlySnapshot, deriveItem, evaluate } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveItem' | 'evaluate'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [{ name: 'test', item_text: 'x' }] })).content[0].text);
  expect(result.results[0].comparison.contextDifferent).toBe(false);
  expect(result.results[0].comparison.metrics.Life.delta).toBe(20);
});
