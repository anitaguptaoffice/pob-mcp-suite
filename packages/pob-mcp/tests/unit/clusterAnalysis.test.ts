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
it('exposes the old keyword heuristic separately with disabled inputs and unknown allocations', async () => {
  const jewels = [
    { socketNodeId: 10, graphAvailable: true, socketAllocated: true, raw: '1 Added Passive Skill is Feasting Fiends\n1 Added Passive Skill is Touch of Cruelty', notables: [{ id: 11, name: 'Feasting Fiends', allocated: true }, { id: 12, name: 'Touch of Cruelty', allocated: false }] },
    { socketNodeId: 20, graphAvailable: false, raw: '1 Added Passive Skill is Renewal' },
    { socketNodeId: 30, graphAvailable: false },
    { socketNodeId: 40, graphAvailable: true, raw: '1 Added Passive Skill is Renewal', notables: [{ id: 41, name: 'Renewal', allocated: true }, { id: 42, name: 'Renewal', allocated: false }] },
  ];
  const getSkills = jest.fn().mockResolvedValue({ groups: [{ index: 1, enabled: false, slotEnabled: true, gems: [{ index: 1, name: 'Summon Raging Spirit', enabled: true }] }, { index: 2, enabled: true, slotEnabled: true, gems: [{ index: 1, name: 'Caustic Arrow', enabled: true }] }] });
  const engine = { getClusterJewels: async () => ({ treeVersion: '3_13', jewels }), getSkills };
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ snapshotId: 'a'.repeat(64), warnings: [], result: await callback(engine) }));
  const tool = createClusterAnalysisTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  const defaultReport = JSON.parse((await tool.invoke({ snapshot_id: 'a'.repeat(64) })).content[0].text);
  expect(defaultReport.heuristic).toBeUndefined(); expect(getSkills).not.toHaveBeenCalled();
  const result = JSON.parse((await tool.invoke({ snapshot_id: 'a'.repeat(64), include_heuristic: true })).content[0].text);
  expect(result.jewels).toEqual(jewels);
  expect(result.heuristic).toMatchObject({ status: 'unverified', archetypeTags: ['minion', 'chaos'], gemInputs: [{ name: 'Summon Raging Spirit', groupEnabled: false }, { name: 'Caustic Arrow', groupEnabled: true }] });
  expect(result.heuristic.jewels[0].notables).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Feasting Fiends', matchesArchetype: true, allocation: true }), expect.objectContaining({ name: 'Touch of Cruelty', matchesArchetype: true, allocation: false })]));
  expect(result.heuristic.jewels[1].notables[0]).toMatchObject({ name: 'Renewal', allocation: null });
  expect(result.heuristic.jewels[2]).toMatchObject({ rawAvailable: false, notables: [] });
  expect(result.heuristic.jewels[3].notables[0]).toMatchObject({ name: 'Renewal', allocation: null });
  expect(result.warnings.join(' ')).toMatch(/disabled and inactive/);
  await expect(tool.invoke({ snapshot_id: 'a'.repeat(64), include_heuristic: 'true' })).rejects.toThrow();
});
