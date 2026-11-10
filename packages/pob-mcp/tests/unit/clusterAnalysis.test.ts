import { createClusterAnalysisTool } from '../../src/features/clusterAnalysis/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

it('keeps actual notable allocation distinct from missing graphs', async () => {
  const id = 'a'.repeat(64), jewels = [
    { socketNodeId: 10, graphAvailable: true, socketAllocated: true, notables: [{ id: 100, name: 'One', allocated: true }, { id: 101, name: 'Two', allocated: false }] },
    { socketNodeId: 20, graphAvailable: false, socketAllocated: false },
    { socketNodeId: 30, graphAvailable: false },
  ];
  const runReadOnlySnapshot = jest.fn().mockResolvedValue({ snapshotId: id, warnings: [], result: { treeVersion: '3_13', jewels } });
  const tool = createClusterAnalysisTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(result.jewels).toEqual(jewels); expect(result.graphUnavailableCount).toBe(2);
  expect(result.jewels[2].socketAllocated).toBeUndefined(); expect(result.jewels[1].notables).toBeUndefined();
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Valid snapshot'); expect(runReadOnlySnapshot).toHaveBeenCalledTimes(1);
});
it('rejects malformed allocation data instead of inventing results', async () => {
  const runReadOnlySnapshot = jest.fn().mockResolvedValue({ warnings: [], result: { treeVersion: '3_13', jewels: [{ socketNodeId: 1, graphAvailable: true, notables: [{ id: 2, name: 'X' }] }] } });
  const tool = createClusterAnalysisTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  await expect(tool.invoke({ snapshot_id: 'a'.repeat(64) })).rejects.toThrow('invalid cluster jewel');
});
