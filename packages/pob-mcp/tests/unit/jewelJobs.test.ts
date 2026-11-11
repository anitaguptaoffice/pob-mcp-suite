import { createJewelJobTools } from '../../src/features/jewelComparison/jobTools.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { JobRunner } from '../../src/foundation/jobRunner.js';
const id = 'a'.repeat(64), child = 'b'.repeat(64), identity = { engineVersion: 'e', adapterVersion: 'a', dataVersion: 'd', runtimeVersion: null, executableVersion: 'x' };
const input = { kind: 'jewel', snapshotId: id, socketNodeId: 10, fields: ['Life'], name: 'one', itemText: 'item', discoveryIdentity: identity };
const entry = (name: string, before: number) => ({ snapshotId: id, socketNodeId: 10, fields: ['Life'], currentDiagnostics: { status: 'empty' }, results: [{ name, status: 'compared', snapshot: { id: child }, parseDiagnostics: { diagnostics: { unparsed: [] } }, comparison: { baseline: { snapshotId: id, identity, context: { skills: { groups: [{}] } } }, candidate: { snapshotId: child }, metrics: { Life: { status: 'available', baseline: { status: 'available', value: before }, candidate: { status: 'available', value: 120 }, delta: 120 - before } } } }] });
it('submits bounded candidates without starting PoB', async () => {
  const readSnapshot = jest.fn().mockResolvedValue(identity), submitJewels = jest.fn().mockResolvedValue({ id: 'job', status: 'queued' }), get = jest.fn();
  const tool = createJewelJobTools({ readSnapshot } as unknown as Pick<BuildFoundation, 'readSnapshot'>, { submitJewels, get } as unknown as Pick<JobRunner, 'submitJewels' | 'get'>)[0];
  const result = JSON.parse((await tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [{ name: 'one', item_text: 'item' }] })).content[0].text);
  expect(result.jobId).toBe('job'); expect(submitJewels).toHaveBeenCalledWith([input]);
  await expect(tool.invoke({ snapshot_id: id, socket_node_id: 10, fields: ['Life'], candidates: [] })).rejects.toThrow('Invalid'); expect(readSnapshot).toHaveBeenCalledTimes(1);
});
it('exposes persisted progress for interrupted jobs', async () => {
  const get = jest.fn().mockResolvedValue({ id: 'job', status: 'interrupted', items: [{ status: 'interrupted', input, progress: { phase: 'derived', snapshotId: child } }] });
  const tool = createJewelJobTools({} as Pick<BuildFoundation, 'readSnapshot'>, { get } as unknown as Pick<JobRunner, 'submitJewels' | 'get'>)[1];
  const result = JSON.parse((await tool.invoke({ job_id: 'job' })).content[0].text);
  expect(result.status).toBe('partial'); expect(result.results[0]).toMatchObject({ status: 'interrupted', snapshotId: child });
});
it('withholds deltas when separately calculated baselines disagree', async () => {
  const get = jest.fn().mockResolvedValue({ id: 'job', status: 'completed', items: [
    { status: 'completed', input, progress: { phase: 'derived', snapshotId: child }, result: entry('one', 100) },
    { status: 'completed', input: { ...input, name: 'two' }, progress: { phase: 'derived', snapshotId: child }, result: entry('two', 101) },
  ] });
  const tool = createJewelJobTools({} as Pick<BuildFoundation, 'readSnapshot'>, { get } as unknown as Pick<JobRunner, 'submitJewels' | 'get'>)[1];
  const result = JSON.parse((await tool.invoke({ job_id: 'job' })).content[0].text);
  expect(result.baselineMismatch).toBe(true); expect(result.status).toBe('partial');
  expect(result.results.every((item: any) => item.status === 'unranked' && item.comparison.metrics.Life.delta === null)).toBe(true);
});
it('keeps generated-group reindexing unverified in a completed job', async () => {
  const report = entry('one', 100);
  report.results[0].comparison.metrics.Life.status = 'context_reindexed_unverified';
  const get = jest.fn().mockResolvedValue({ id: 'job', status: 'completed', items: [{ status: 'completed', input, result: report }] });
  const tool = createJewelJobTools({} as Pick<BuildFoundation, 'readSnapshot'>, { get } as unknown as Pick<JobRunner, 'submitJewels' | 'get'>)[1];
  const result = JSON.parse((await tool.invoke({ job_id: 'job' })).content[0].text);
  expect(result.status).toBe('partial');
  expect(result.results[0].comparison.metrics.Life.status).toBe('context_reindexed_unverified');
});
