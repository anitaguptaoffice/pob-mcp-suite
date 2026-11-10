import { createPassiveRankingTools, evaluatePassive } from '../../src/features/passiveRanking/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { JobRunner, PassiveEvaluationInput } from '../../src/foundation/jobRunner.js';
const parent = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const input = (nodeId: number, pathNodes: number[]): PassiveEvaluationInput => ({ kind: 'passive', snapshotId: parent, nodeId, nodeName: `node ${nodeId}`, pathNodes, metrics: ['MinionCombinedDPS', 'Life'], discoveryIdentity: identity, treeVersion: '3_29' });
const observation = (snapshotId: string, damage: number, life = 100) => ({ snapshotId, identity, context: { skills: {}, config: {}, build: {} }, warnings: [], metrics: { MinionCombinedDPS: { status: 'available', value: damage }, Life: { status: 'available', value: life } } });
const result = (damage: number, life = 100) => ({ baseline: observation(parent, 100, 100), candidate: observation(child, damage, life), candidateSnapshotId: child });
function setup() {
  const get = jest.fn(), submitPassives = jest.fn();
  const tools = createPassiveRankingTools({} as Pick<BuildFoundation, 'runReadOnlySnapshot'>, { get, submitPassives } as unknown as Pick<JobRunner, 'get' | 'submitPassives'>);
  return { get, submit: tools[0], summary: tools[1] };
}
const decode = async (tool: ReturnType<typeof setup>['summary']) => JSON.parse((await tool.invoke({ job_id: 'job' })).content[0].text);
describe('passive ranking', () => {
  it('scores real metric deltas relative to the baseline and divides by path cost', async () => {
    const test = setup(); test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [
      { status: 'completed', input: input(2, [1, 2]), result: result(120, 110) },
      { status: 'completed', input: input(3, [3]), result: result(110, 105) },
    ] });
    const report = await decode(test.summary);
    expect(report.status).toBe('complete'); expect(report.ranked[0].nodeId).toBe(2);
    expect(report.ranked[0].score).toBeCloseTo(0.15); expect(report.ranked[0].metrics.MinionCombinedDPS.delta).toBe(20);
  });
  it('preserves failures and withholds rankings when baselines disagree', async () => {
    const test = setup(); const changed = result(110); changed.baseline.metrics.Life.value = 90;
    test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [
      { status: 'completed', input: input(2, [1, 2]), result: result(120) },
      { status: 'completed', input: input(3, [3]), result: changed },
      { status: 'failed', input: input(4, [4]), error: 'engine failed' },
    ] });
    const report = await decode(test.summary);
    expect(report.status).toBe('partial'); expect(report.baselineMismatch).toBe(true); expect(report.ranked).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: 'unranked', metrics: null, score: null });
    expect(report.results[2]).toMatchObject({ status: 'failed', reason: 'engine failed' });
  });
  it('excludes ascendancy and anointment-only notables before submitting paths', async () => {
    const node = (id: number) => ({ id, name: `node ${id}`, type: 'notable', stats: [], allocated: false, isBlighted: false, status: 'reachable', pathNodes: [id], pointCost: 1 });
    const queryTreePaths = jest.fn().mockResolvedValue({ mode: 'nearby', treeVersion: '3_29', maxDistance: 3, total: 3, nodes: [node(1), { ...node(2), ascendancyName: 'Other Class' }, { ...node(3), isBlighted: true }] });
    const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ snapshotId: parent, identity, warnings: [], result: await callback({ queryTreePaths }) }));
    const submitPassives = jest.fn().mockResolvedValue({ id: 'job', status: 'queued' });
    const [submit] = createPassiveRankingTools({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>, { submitPassives } as unknown as Pick<JobRunner, 'submitPassives' | 'get'>);
    const report = JSON.parse((await submit.invoke({ snapshot_id: parent, metrics: ['Life'] })).content[0].text);
    expect(report).toMatchObject({ submitted: 1, excludedBlighted: 1, excludedAscendancy: 1 });
    expect(submitPassives.mock.calls[0][0].map((entry: PassiveEvaluationInput) => entry.nodeId)).toEqual([1]);
  });
  it('retains a child ID if the post-change calculation fails', async () => {
    const evaluate = jest.fn().mockResolvedValueOnce(observation(parent, 100)).mockRejectedValueOnce(new Error('calculation failed'));
    const deriveTree = jest.fn().mockResolvedValue({ id: child });
    const output = await evaluatePassive({ evaluate, deriveTree } as unknown as Pick<BuildFoundation, 'evaluate' | 'deriveTree'>, input(2, [1, 2]));
    expect(deriveTree).toHaveBeenCalledWith(parent, [1, 2], [], {}, true);
    expect(output).toMatchObject({ candidateSnapshotId: child, error: 'calculation failed' });
  });
});
