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
  it('ranks only candidates meeting calculated minimums and distinguishes unknown from zero', async () => {
    const test = setup();
    const good = result(120, 110), low = result(110, 90), unknown = result(115, 105);
    for (const entry of [good, low, unknown]) {
      (entry.baseline.metrics as any).EnergyShield = { status: 'available', value: 0 };
      (entry.candidate.metrics as any).EnergyShield = { status: 'available', value: 0 };
    }
    (unknown.candidate.metrics as any).EnergyShield = { status: 'unavailable' };
    const constrained = (id: number) => ({ ...input(id, [id]), minimums: { Life: 100, EnergyShield: 0 } });
    test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [
      { status: 'completed', input: constrained(2), result: good },
      { status: 'completed', input: constrained(3), result: low },
      { status: 'completed', input: constrained(4), result: unknown },
    ] });
    const report = await decode(test.summary);
    expect(report.status).toBe('partial'); expect(report.minimums).toEqual({ Life: 100, EnergyShield: 0 });
    expect(report.ranked.map((entry: { nodeId: number }) => entry.nodeId)).toEqual([2]);
    expect(report.results[0].constraints.EnergyShield).toEqual({ minimum: 0, actual: 0, met: true });
    expect(report.results[1]).toMatchObject({ status: 'below_minimum', constraints: { Life: { actual: 90, met: false } } });
    expect(report.results[2]).toMatchObject({ status: 'unavailable', constraints: { EnergyShield: { actual: null, met: null } } });
  });
  it('evaluates additional constraint metrics once alongside scoring metrics', async () => {
    const evaluate = jest.fn().mockResolvedValue(observation(parent, 100));
    const deriveTree = jest.fn().mockResolvedValue({ id: child });
    await evaluatePassive({ evaluate, deriveTree } as unknown as Pick<BuildFoundation, 'evaluate' | 'deriveTree'>, { ...input(2, [2]), metrics: ['MinionCombinedDPS'], minimums: { Life: 1, EnergyShield: 0 } });
    expect(evaluate).toHaveBeenNthCalledWith(1, parent, ['MinionCombinedDPS', 'Life', 'EnergyShield']);
    expect(evaluate).toHaveBeenNthCalledWith(2, child, ['MinionCombinedDPS', 'Life', 'EnergyShield']);
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
  it('excludes protected targets and intermediate nodes before submitting, and persists the constraint', async () => {
    const node = (id: number, pathNodes: number[]) => ({ id, name: `node ${id}`, type: 'notable', stats: [], allocated: false, isBlighted: false, status: 'reachable', pathNodes, pointCost: pathNodes.length });
    const queryTreePaths = jest.fn().mockResolvedValue({ mode: 'nearby', treeVersion: '3_29', maxDistance: 3, total: 3, nodes: [node(2, [1, 2]), node(3, [3]), node(4, [4])] });
    const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ snapshotId: parent, identity, warnings: [], result: await callback({ queryTreePaths }) }));
    const submitPassives = jest.fn().mockResolvedValue({ id: 'job', status: 'queued' });
    const [submit] = createPassiveRankingTools({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>, { submitPassives } as unknown as Pick<JobRunner, 'submitPassives' | 'get'>);
    const report = JSON.parse((await submit.invoke({ snapshot_id: parent, metrics: ['Life'], excluded_node_ids: [1, 3] })).content[0].text);
    expect(report).toMatchObject({ submitted: 1, excludedPaths: 2, excludedNodeIds: [1, 3] });
    expect(submitPassives.mock.calls[0][0]).toMatchObject([{ nodeId: 4, pathNodes: [4], excludedNodeIds: [1, 3] }]);
    const none = JSON.parse((await submit.invoke({ snapshot_id: parent, metrics: ['Life'], excluded_node_ids: [1, 3, 4] })).content[0].text);
    expect(none).toMatchObject({ status: 'no_candidates', jobId: null, excludedPaths: 3 });
    expect(submitPassives).toHaveBeenCalledTimes(1);
    await expect(submit.invoke({ snapshot_id: parent, metrics: ['Life'], excluded_node_ids: [1, 1] })).rejects.toThrow('Invalid passive ranking options');
    await expect(submit.invoke({ snapshot_id: parent, metrics: ['Life'], min_life: -1 })).rejects.toThrow('Invalid passive minimum constraints');
    await expect(submit.invoke({ snapshot_id: parent, metrics: ['Life'], min_energy_shield: Infinity })).rejects.toThrow('Invalid passive minimum constraints');
  });
  it('rejects persisted jobs whose paths conflict with their exclusions', async () => {
    const test = setup();
    test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [{ status: 'completed', input: { ...input(2, [1, 2]), excludedNodeIds: [1] }, result: result(110) }] });
    await expect(decode(test.summary)).rejects.toThrow('Invalid passive ranking inputs');
    test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [{ status: 'completed', input: { ...input(2, [1, 2]), excludedNodeIds: [9] }, result: result(110) }] });
    expect((await decode(test.summary)).excludedNodeIds).toEqual([9]);
    test.get.mockResolvedValue({ id: 'job', status: 'completed', items: [{ status: 'completed', input: { ...input(2, [1, 2]), excludedNodeIds: 'invalid' }, result: result(110) }] });
    await expect(decode(test.summary)).rejects.toThrow('Invalid passive ranking inputs');
  });
  it('retains a child ID if the post-change calculation fails', async () => {
    const evaluate = jest.fn().mockResolvedValueOnce(observation(parent, 100)).mockRejectedValueOnce(new Error('calculation failed'));
    const deriveTree = jest.fn().mockResolvedValue({ id: child });
    const output = await evaluatePassive({ evaluate, deriveTree } as unknown as Pick<BuildFoundation, 'evaluate' | 'deriveTree'>, input(2, [1, 2]));
    expect(deriveTree).toHaveBeenCalledWith(parent, [1, 2], [], {}, true);
    expect(output).toMatchObject({ candidateSnapshotId: child, error: 'calculation failed' });
  });
});
