import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { JobStore } from '../../src/foundation/jobStore.js';

describe('JobStore', () => {
  it('protects interrupted and queued job inputs and refuses ambiguous legacy jobs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-jobs-'));
    try {
      const jobs = new JobStore(dir);
      const first = 'a'.repeat(64), second = 'b'.repeat(64);
      const queued = await jobs.create(1, [{ snapshotId: first }]);
      const running = await jobs.create(1, [{ snapshotId: second }]);
      await jobs.start(running.id);
      await jobs.markInterrupted();
      expect((await jobs.get(queued.id)).status).toBe('interrupted');
      expect(await jobs.protectedSnapshotIds()).toEqual(new Set([first, second]));
      await jobs.create(1);
      await expect(jobs.protectedSnapshotIds()).rejects.toThrow('missing a valid snapshot reference');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('persists concurrent item updates and does not declare pending work complete', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-jobs-'));
    try {
      const jobs = new JobStore(dir);
      const job = await jobs.create(3);
      await jobs.start(job.id);
      await Promise.all([jobs.startItem(job.id, 0), jobs.startItem(job.id, 1)]);
      await Promise.all([
        jobs.recordItem(job.id, 0, { status: 'completed', result: 42 }),
        jobs.recordItem(job.id, 1, { status: 'failed', error: 'failure' }),
      ]);
      await expect(jobs.finish(job.id)).rejects.toThrow('pending');
      const saved = await new JobStore(dir).get(job.id);
      expect(saved.items).toEqual([{ status: 'completed', result: 42 }, { status: 'failed', error: 'failure' }, { status: 'pending' }]);
      await jobs.startItem(job.id, 2);
      await jobs.recordItem(job.id, 2, { status: 'completed', result: 7 });
      expect((await jobs.finish(job.id)).status).toBe('completed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('marks cancellation only after running work has stopped and recovers unfinished work as interrupted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-jobs-'));
    try {
      const jobs = new JobStore(dir);
      const running = await jobs.create(2);
      await jobs.start(running.id);
      await jobs.startItem(running.id, 0);
      expect((await jobs.requestCancel(running.id)).status).toBe('cancel_requested');
      // A started item may complete after cancellation is requested.
      await jobs.recordItem(running.id, 0, { status: 'completed', result: 1 });
      const cancelled = await jobs.finish(running.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.items[1].status).toBe('pending');
      const queued = await jobs.create(1);
      const crashed = await jobs.create(1);
      await jobs.start(crashed.id);
      await jobs.startItem(crashed.id, 0);
      expect(await new JobStore(dir).markInterrupted()).toBe(2);
      expect((await jobs.get(queued.id)).status).toBe('interrupted');
      expect((await jobs.get(crashed.id)).status).toBe('interrupted');
      expect((await jobs.get(crashed.id)).items[0].status).toBe('interrupted');
      expect((await jobs.get(running.id)).status).toBe('cancelled');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
