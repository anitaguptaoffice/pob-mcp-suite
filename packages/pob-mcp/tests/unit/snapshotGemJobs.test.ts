import { createGemSetupJobTools } from '../../src/features/snapshotGemComparison/jobTools.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { GemSetupEvaluationInput, JobRunner } from '../../src/foundation/jobRunner.js';
const parent = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const skills = { mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [{ name: 'SRS', isSupport: false, enabled: true }] }] };
const baseline = { identity, context: { skills, config: {} }, metrics: { MinionCombinedDPS: { status: 'available', value: 100 } }, warnings: [] };
const makeInput = (setupName: string): GemSetupEvaluationInput => ({ kind: 'gem_setup', snapshotId: parent, groupIndex: 1, setupName, gems: [{ gemName: 'SRS' }], discoveryIdentity: identity });
const report = (value: number) => ({ snapshotId: parent, groupIndex: 1, baseline, results: [{ snapshotId: child, status: 'ok', identityUnknown: [], metrics: { MinionCombinedDPS: { delta: value } } }] });
function setup() {
  const inspect = jest.fn().mockResolvedValue({ snapshotId: parent, data: { skills }, identity, warnings: [] });
  const submitGemSetups = jest.fn().mockResolvedValue({ id: 'job', status: 'queued' }), get = jest.fn();
  const tools = createGemSetupJobTools({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>, { submitGemSetups, get } as unknown as Pick<JobRunner, 'submitGemSetups' | 'get'>);
  return { inspect, submitGemSetups, get, submit: tools[0], summary: tools[1] };
}
const args = { snapshot_id: parent, group_index: 1, setups: [{ name: 'one', gems: [{ gemName: 'SRS' }] }, { name: 'two', gems: [{ gemName: 'SRS' }] }] };
describe('snapshot gem setup jobs', () => {
  it('submits every setup from the same snapshot with explicit baseline identity', async () => {
    const test = setup(), output = JSON.parse((await test.submit.invoke(args)).content[0].text);
    expect(output).toMatchObject({ jobId: 'job', setupCount: 2, activeGem: 'SRS' });
    expect(test.submitGemSetups).toHaveBeenCalledWith([makeInput('one'), makeInput('two')]);
  });
  it('rejects malformed and missing active gems before submitting', async () => {
    const test = setup();
    await expect(test.submit.invoke({ ...args, setups: [args.setups[0], { name: 'two', gems: [{ gemName: 'Other' }] }] })).rejects.toThrow('retain');
    await expect(test.submit.invoke({ ...args, setups: [args.setups[0], { name: 'ONE', gems: [{ gemName: 'SRS' }] }] })).rejects.toThrow('Invalid');
    expect(test.submitGemSetups).not.toHaveBeenCalled();
  });
  it('returns both setups and preserves failed or pending results as partial', async () => {
    const test = setup(), first = makeInput('one'), second = makeInput('two');
    test.get.mockResolvedValueOnce({ id: 'job', status: 'completed', items: [{ status: 'completed', input: first, result: report(10) }, { status: 'completed', input: second, result: report(20) }] });
    const full = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(full.status).toBe('complete'); expect(full.results.map((entry: { name: string }) => entry.name)).toEqual(['one', 'two']);
    expect(full.results[1].metrics.MinionCombinedDPS.delta).toBe(20);
    test.get.mockResolvedValueOnce({ id: 'job', status: 'running', items: [{ status: 'completed', input: first, result: report(10) }, { status: 'pending', input: second }] });
    const partial = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(partial.status).toBe('partial'); expect(partial.results[1].status).toBe('pending');
  });
  it('withholds deltas for changed baselines and reports a later comparison failure with its snapshot', async () => {
    const test = setup(), first = makeInput('one'), second = makeInput('two');
    test.get.mockResolvedValueOnce({ id: 'job', status: 'completed', items: [{ status: 'completed', input: first, result: report(10) }, { status: 'completed', input: second, result: { ...report(20), baseline: { ...baseline, metrics: {} } } }] });
    const mismatch = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(mismatch.baselineMismatch).toBe(true); expect(mismatch.results[0]).toMatchObject({ status: 'unranked', metrics: null });
    test.get.mockResolvedValueOnce({ id: 'job', status: 'completed', items: [{ status: 'completed', input: first, result: report(10) }, { status: 'completed', input: second, result: { setupError: 'engine failed', candidateSnapshotId: child } }] });
    const partial = JSON.parse((await test.summary.invoke({ job_id: 'job' })).content[0].text);
    expect(partial.results[1]).toMatchObject({ status: 'error', snapshotId: child, reason: 'engine failed' });
  });
});
