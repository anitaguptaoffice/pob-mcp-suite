import { createMasteryJobTools } from '../../src/features/masteryRanking/jobTools.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { JobRunner, MasteryEvaluationInput } from '../../src/foundation/jobRunner.js';
const snapshotId = 'a'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const input = (nodeId: number, effectId: number): MasteryEvaluationInput => ({ kind: 'mastery', snapshotId, nodeId, effectId, metric: 'MinionCombinedDPS', direction: 'higher', treeVersion: '3_29', discoveryIdentity: identity, includeCurrent: false, selected: false, totalDiscovered: 4, totalMasteries: 2 });
const baseline = { value: 100, identity, warnings: [], context: { config: {}, skills: {}, build: {} } };
const report = (candidate: MasteryEvaluationInput, delta: number) => ({ snapshotId, nodeId: candidate.nodeId, treeVersion: '3_29', metric: candidate.metric, direction: candidate.direction, baseline, results: [{ effectId: candidate.effectId, status: 'ok', delta, identityUnknown: [] }] });
const job = (items: unknown[], status = 'completed') => ({ id: 'job', status, items });
function setup() {
  const masteryOptions = jest.fn().mockResolvedValue({ snapshotId, identity, treeVersion: '3_29', warnings: [], masteries: [
    { nodeId: 10, allocatedEffect: 1, availableEffects: [{ effectId: 1, stat: 'current' }, { effectId: 2, stat: 'new' }] },
    { nodeId: 20, allocatedEffect: 3, availableEffects: [{ effectId: 3, stat: 'current' }, { effectId: 4, stat: 'new' }] },
  ] });
  const submitMasteries = jest.fn().mockResolvedValue({ id: 'job', status: 'queued' });
  const get = jest.fn();
  const tools = createMasteryJobTools({ masteryOptions } as unknown as Pick<BuildFoundation, 'masteryOptions'>, { submitMasteries, get } as unknown as Pick<JobRunner, 'submitMasteries' | 'get'>);
  return { masteryOptions, submitMasteries, get, submit: tools[0], summary: tools[1] };
}
describe('mastery ranking jobs', () => {
  it('discovers and submits all non-selected effects with one snapshot and metric', async () => {
    const test = setup();
    const response = JSON.parse((await test.submit.invoke({ snapshot_id: snapshotId, metric: 'MinionCombinedDPS' })).content[0].text);
    expect(response).toMatchObject({ jobId: 'job', totalCandidates: 2, totalMasteries: 2, includeCurrent: false });
    expect(test.submitMasteries).toHaveBeenCalledWith([input(10, 2), input(20, 4)]);
    await test.submit.invoke({ snapshot_id: snapshotId, metric: 'MinionCombinedDPS', include_current: true });
    expect(test.submitMasteries.mock.calls[1][0]).toHaveLength(4);
  });
  it('combines comparable results across nodes and marks pending or failed candidates partial', async () => {
    const test = setup(), first = input(10, 2), second = input(20, 4);
    test.get.mockResolvedValueOnce(job([{ input: first, status: 'completed', result: report(first, 5) }, { input: second, status: 'completed', result: report(second, 10) }]));
    const complete = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(complete.status).toBe('complete'); expect(complete.ranked.map((item: { effectId: number }) => item.effectId)).toEqual([4, 2]);
    test.get.mockResolvedValueOnce(job([{ input: first, status: 'completed', result: report(first, 5) }, { input: second, status: 'completed', result: report(second, 10) }]));
    const page = JSON.parse((await test.summary.invoke({ job_id: 'job', limit: 1 })).content[0].text);
    expect(page.totalRanked).toBe(2); expect(page.ranked[0].effectId).toBe(4); expect(page.nextRankedOffset).toBe(1); expect(page.nextResultsOffset).toBe(1);
    test.get.mockResolvedValueOnce(job([{ input: first, status: 'completed', result: report(first, 5) }, { input: second, status: 'pending' }], 'running'));
    expect(JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text).status).toBe('partial');
  });
  it('refuses cross-candidate ranking when baselines or discovered versions differ', async () => {
    const test = setup(), first = input(10, 2), second = input(20, 4);
    test.get.mockResolvedValueOnce(job([{ input: first, status: 'completed', result: report(first, 5) }, { input: second, status: 'completed', result: { ...report(second, 10), baseline: { ...baseline, value: 101 } } }]));
    const changed = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(changed.baselineMismatch).toBe(true); expect(changed.ranked).toEqual([]);
    test.get.mockResolvedValueOnce(job([{ input: first, status: 'completed', result: { ...report(first, 5), treeVersion: 'other' } }]));
    expect(JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text).ranked).toEqual([]);
  });
  it('reports empty discovery and rejects ordinary evaluation jobs', async () => {
    const test = setup(); test.masteryOptions.mockResolvedValueOnce({ snapshotId, identity, treeVersion: '3_29', warnings: [], masteries: [] });
    expect(JSON.parse((await test.submit.invoke({ snapshot_id: snapshotId, metric: 'Life' })).content[0].text).status).toBe('no_candidates');
    expect(test.submitMasteries).not.toHaveBeenCalled();
    test.get.mockResolvedValueOnce(job([{ input: { snapshotId, fields: ['Life'] }, status: 'completed' }]));
    await expect(test.summary.invoke({ job_id: 'job' })).rejects.toThrow('not a mastery ranking');
  });
  it('keeps candidates when the selected effect is unknown and reports the uncertainty', async () => {
    const test = setup();
    test.masteryOptions.mockResolvedValueOnce({ snapshotId, identity, treeVersion: '3_29', warnings: [], masteries: [{ nodeId: 10, availableEffects: [{ effectId: 2, stat: 'new' }] }] });
    const response = JSON.parse((await test.submit.invoke({ snapshot_id: snapshotId, metric: 'MinionCombinedDPS' })).content[0].text);
    expect(response.unknownCurrentNodes).toEqual([10]);
    expect(test.submitMasteries).toHaveBeenCalledWith([{ ...input(10, 2), selected: null, totalDiscovered: 1, totalMasteries: 1 }]);
    const unknown = { ...input(10, 2), selected: null, totalDiscovered: 1, totalMasteries: 1 };
    test.get.mockResolvedValueOnce(job([{ input: unknown, status: 'completed', result: report(unknown, 5) }]));
    const summary = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(summary.unknownCurrentNodes).toEqual([10]);
    expect(summary.warnings.join(' ')).toContain('Current effect is unknown');
  });
});
