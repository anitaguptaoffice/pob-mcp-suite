import { createSnapshotTreeComparisonTool } from '../../src/features/treeComparison/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

describe('snapshot tree comparison', () => {
  const observation = (snapshotId: string, tree: unknown) => ({ snapshotId, data: { tree }, identity: {}, warnings: [] });
  it('compares only the requested snapshot trees, including changed masteries and class', async () => {
    const inspect = jest.fn().mockResolvedValueOnce(observation('before', { treeVersion: '3_28', nodes: [1, 2, 4], masteryEffects: { 2: 100, 4: 200 }, className: 'Witch' }))
      .mockResolvedValueOnce(observation('after', { treeVersion: '3_28', nodes: [2, 3, 4], masteryEffects: { 2: 101, 3: 300 }, className: 'Marauder' }));
    const tool = createSnapshotTreeComparisonTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>);
    const result = JSON.parse((await tool.invoke({ baseline_snapshot_id: 'before', candidate_snapshot_id: 'after' })).content[0].text);
    expect(inspect.mock.calls).toEqual([['before', ['tree']], ['after', ['tree']]]);
    expect(result.nodesAdded).toEqual([3]); expect(result.nodesRemoved).toEqual([1]);
    expect(result.masteryChanges).toEqual([{ nodeId: 2, before: 100, after: 101 }, { nodeId: 3, before: null, after: 300 }, { nodeId: 4, before: 200, after: null }]);
    expect(result.baseline.character.className).toBe('Witch'); expect(result.candidate.character.className).toBe('Marauder');
  });
  it('rejects incompatible or unknown tree versions and malformed observations', async () => {
    for (const candidate of [{ treeVersion: 'other', nodes: [], masteryEffects: {} }, { nodes: [], masteryEffects: {} }, { treeVersion: '3_28', nodes: [1, 1], masteryEffects: {} }, { treeVersion: '3_28', nodes: [], masteryEffects: { '1': 0 } }]) {
      const inspect = jest.fn().mockResolvedValueOnce(observation('before', { treeVersion: '3_28', nodes: [], masteryEffects: {} })).mockResolvedValueOnce(observation('after', candidate));
      const tool = createSnapshotTreeComparisonTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>);
      await expect(tool.invoke({ baseline_snapshot_id: 'before', candidate_snapshot_id: 'after' })).rejects.toThrow();
    }
  });
  it('accepts Lua empty mastery arrays and propagates inspection failures', async () => {
    const inspect = jest.fn().mockResolvedValue(observation('same', { treeVersion: '3_28', nodes: [], masteryEffects: [] }));
    const tool = createSnapshotTreeComparisonTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>);
    expect(JSON.parse((await tool.invoke({ baseline_snapshot_id: 'same', candidate_snapshot_id: 'same' })).content[0].text).masteryChanges).toEqual([]);
    inspect.mockRejectedValueOnce(new Error('engine unavailable'));
    await expect(tool.invoke({ baseline_snapshot_id: 'same', candidate_snapshot_id: 'same' })).rejects.toThrow('engine unavailable');
  });
  it('rejects observations produced by different known PoB data identities', async () => {
    const tree = { treeVersion: '3_28', nodes: [], masteryEffects: {} };
    const inspect = jest.fn().mockResolvedValueOnce({ ...observation('before', tree), identity: { dataVersion: 'a' } }).mockResolvedValueOnce({ ...observation('after', tree), identity: { dataVersion: 'b' } });
    const tool = createSnapshotTreeComparisonTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>);
    await expect(tool.invoke({ baseline_snapshot_id: 'before', candidate_snapshot_id: 'after' })).rejects.toThrow('different dataVersion');
  });
});
