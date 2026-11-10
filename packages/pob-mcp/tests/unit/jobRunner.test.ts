import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { JobRunner } from '../../src/foundation/jobRunner.js';
import { JobStore } from '../../src/foundation/jobStore.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const input = { snapshotId: 'a'.repeat(64), fields: ['Life'] };
describe('JobRunner', () => {
  it('runs mastery candidates with the same durable cancellation and snapshot protection', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-mastery-runner-'));
    try {
      const entered = deferred(), gate = deferred();
      const store = new JobStore(dir);
      const runMastery = jest.fn(async () => { entered.resolve(); await gate.promise; return { value: 10 }; });
      const runner = new JobRunner(store, async () => { throw new Error('wrong dispatcher'); }, 1, runMastery);
      const candidate = { kind: 'mastery' as const, snapshotId: input.snapshotId, nodeId: 10, effectId: 20, metric: 'Life', direction: 'higher' as const, treeVersion: '3_29', discoveryIdentity: { engineVersion: 'a', adapterVersion: 'b', dataVersion: 'c' }, includeCurrent: false, selected: false, totalDiscovered: 2, totalMasteries: 1 };
      const job = await runner.submitMasteries([candidate, { ...candidate, effectId: 21 }]);
      await entered.promise;
      expect(await store.protectedSnapshotIds()).toEqual(new Set([input.snapshotId]));
      expect((await runner.cancel(job.id)).status).toBe('cancel_requested');
      gate.resolve(); await runner.close();
      const saved = await store.get(job.id);
      expect(saved.status).toBe('cancelled');
      expect(saved.items[0]).toMatchObject({ status: 'completed', input: candidate, result: { value: 10 } });
      expect(saved.items[1].status).toBe('pending');
      expect(runMastery).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not let ordinary evaluation inputs bypass mastery job validation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-runner-kind-'));
    try {
      const runner = new JobRunner(new JobStore(dir), async () => ({}));
      await expect(runner.submit([{ ...input, kind: 'mastery' } as typeof input])).rejects.toThrow('Invalid evaluation item');
      await runner.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('preserves mastery job inputs and roots when a running task is marked interrupted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-mastery-interrupted-'));
    try {
      const store = new JobStore(dir);
      const candidate = { kind: 'mastery', snapshotId: input.snapshotId, nodeId: 10, effectId: 20, metric: 'Life', direction: 'higher', treeVersion: '3_29', discoveryIdentity: { engineVersion: 'a', adapterVersion: 'b', dataVersion: 'c' }, includeCurrent: false, selected: null, totalDiscovered: 1, totalMasteries: 1 };
      const job = await store.create(1, [candidate]); await store.start(job.id); await store.startItem(job.id, 0);
      expect(await store.markInterrupted()).toBe(1);
      const restored = await store.get(job.id);
      expect(restored.status).toBe('interrupted');
      expect(restored.items[0]).toMatchObject({ status: 'interrupted', input: candidate });
      expect(await store.protectedSnapshotIds()).toEqual(new Set([input.snapshotId]));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('keeps cancellation pending until the active item finishes and persists results', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-runner-'));
    try {
      const entered = deferred(), gate = deferred();
      let calls = 0;
      const store = new JobStore(dir);
      const runner = new JobRunner(store, async () => { calls++; entered.resolve(); await gate.promise; return { Life: 10 }; }, 1);
      const job = await runner.submit([input, input]);
      await entered.promise;
      await expect(runner.submit([input])).rejects.toThrow('full');
      expect((await runner.cancel(job.id)).status).toBe('cancel_requested');
      gate.resolve();
      await runner.close();
      const final = await store.get(job.id);
      expect(final.status).toBe('cancelled');
      expect(final.items[0]).toMatchObject({ status: 'completed', input, result: { Life: 10 } });
      expect(final.items[1]).toMatchObject({ status: 'pending', input });
      expect(calls).toBe(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('finishes submission racing with shutdown before shutdown returns', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-runner-'));
    try {
      const store = new JobStore(dir);
      const gate = deferred();
      const original = store.create.bind(store);
      jest.spyOn(store, 'create').mockImplementation(async (...args) => { await gate.promise; return original(...args); });
      const runner = new JobRunner(store, async () => { throw new Error('must not run'); });
      const submission = runner.submit([input]);
      const closing = runner.close();
      gate.resolve();
      const job = await submission;
      await closing;
      expect((await store.get(job.id)).status).toBe('cancelled');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('validates and copies options before a queued job is executed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-runner-'));
    try {
      const gate = deferred();
      const store = new JobStore(dir);
      const original = store.create.bind(store);
      jest.spyOn(store, 'create').mockImplementation(async (...args) => { await gate.promise; return original(...args); });
      const evaluate = jest.fn(async value => value);
      const runner = new JobRunner(store, evaluate);
      await expect(runner.submit([{ ...input, options: { selection: { mainSocketGroup: 0 } } }])).rejects.toThrow('Invalid skill selection');
      const item = { ...input, options: { config: { enemyIsBoss: 'Pinnacle' } } };
      const pending = runner.submit([item]);
      item.options.config.enemyIsBoss = 'changed';
      gate.resolve();
      const job = await pending;
      for (let i = 0; i < 100 && (await store.get(job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
      expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ options: { config: { enemyIsBoss: 'Pinnacle' } } }));
      expect((await store.get(job.id)).items[0].input).toMatchObject({ options: { config: { enemyIsBoss: 'Pinnacle' } } });
      await runner.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
