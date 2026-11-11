import { createSnapshotTreeTransplantTool } from '../../src/features/treeTransplant/tool.js';
import type { BuildEngine, BuildFoundation } from '../../src/foundation/buildFoundation.js';

const source = 'a'.repeat(64), target = 'b'.repeat(64), child = 'c'.repeat(64);
const tree = { classId: 3, ascendClassId: 1, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [1, 2], masteryEffects: [] };
function setup(overrides: unknown = []) {
  const engine = { getTree: async () => tree, getTreeOverrides: async () => overrides } as unknown as BuildEngine;
  const runReadOnlySnapshot = jest.fn(async (id: string, fn: (value: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: { dataVersion: 'v' }, warnings: [], result: await fn(engine) }));
  const deriveTreeReplacement = jest.fn(async () => ({ id: child, parentId: target, xml: '<secret/>', source: 'derived', formatVersion: 1 as const, engineVersion: null, adapterVersion: null, dataVersion: null, limitations: [] }));
  const foundation = { runReadOnlySnapshot, deriveTreeReplacement } as unknown as BuildFoundation;
  return { runReadOnlySnapshot, deriveTreeReplacement, tool: createSnapshotTreeTransplantTool(foundation) };
}
it('copies only the complete active tree into a trial child of the target', async () => {
  const f = setup(), result = JSON.parse((await f.tool.invoke({ source_snapshot_id: source, target_snapshot_id: target })).content[0].text);
  expect(f.deriveTreeReplacement).toHaveBeenCalledWith(target, { ...tree, masteryEffects: {} }, true, 'reject');
  expect(result).toMatchObject({ sourceSnapshotId: source, targetSnapshotId: target, snapshot: { id: child, parentId: target } });
  expect(result.snapshot.xml).toBeUndefined();
});
it('rejects source overrides and malformed inputs before changing the target', async () => {
  const f = setup([{ nodeId: 1 }]);
  await expect(f.tool.invoke({ source_snapshot_id: source, target_snapshot_id: target })).rejects.toThrow('Source tree has node overrides');
  await expect(f.tool.invoke({ source_snapshot_id: source, target_snapshot_id: target, trial: 'yes' })).rejects.toThrow('Invalid');
  expect(f.deriveTreeReplacement).not.toHaveBeenCalled();
});
