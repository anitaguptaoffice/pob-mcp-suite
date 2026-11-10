import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../utils/atomicWrite.js';

export type JobStatus = 'queued' | 'running' | 'cancel_requested' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type JobItem = { status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'; input?: unknown; result?: unknown; error?: string; progress?: { phase: 'derived'; snapshotId: string } };
export interface JobRecord { id: string; status: JobStatus; createdAt: string; updatedAt: string; items: JobItem[]; error?: string }
const terminal = new Set<JobStatus>(['completed', 'cancelled', 'failed', 'interrupted']);

/** Durable state only. The caller owns the store lock and executes jobs separately. */
export class JobStore {
  private readonly updates = new Map<string, Promise<unknown>>();
  constructor(private readonly directory: string) {}
  private file(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid job ID');
    return path.join(this.directory, `${id}.json`);
  }
  private async write(record: JobRecord, overwrite: boolean): Promise<void> {
    await atomicWriteFile(this.file(record.id), JSON.stringify(record), overwrite);
  }
  async create(count: number, inputs?: readonly unknown[]): Promise<JobRecord> {
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Invalid job item count');
    if (inputs && inputs.length !== count) throw new Error('Job inputs do not match item count');
    await fs.mkdir(this.directory, { recursive: true });
    const now = new Date().toISOString();
    const job: JobRecord = { id: randomUUID(), status: 'queued', createdAt: now, updatedAt: now,
      items: Array.from({ length: count }, (_, index) => ({ status: 'pending', ...(inputs ? { input: inputs[index] } : {}) })) };
    await this.write(job, false);
    return job;
  }
  async get(id: string): Promise<JobRecord> {
    return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as JobRecord;
  }
  private async update(id: string, fn: (job: JobRecord) => void): Promise<JobRecord> {
    const previous = this.updates.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const job = await this.get(id);
      fn(job);
      job.updatedAt = new Date().toISOString();
      await this.write(job, true);
      return job;
    });
    this.updates.set(id, current);
    try { return await current; }
    finally { if (this.updates.get(id) === current) this.updates.delete(id); }
  }
  async start(id: string): Promise<JobRecord> {
    return this.update(id, job => { if (job.status !== 'queued') throw new Error('Job is not queued'); job.status = 'running'; });
  }
  async requestCancel(id: string): Promise<JobRecord> {
    return this.update(id, job => {
      if (terminal.has(job.status)) return;
      job.status = job.status === 'queued' ? 'cancelled' : 'cancel_requested';
    });
  }
  async startItem(id: string, index: number): Promise<JobRecord> {
    return this.update(id, job => {
      if (job.status === 'cancel_requested') return;
      if (job.status !== 'running') throw new Error('Job is not running');
      if (!Number.isInteger(index) || index < 0 || index >= job.items.length || job.items[index].status !== 'pending') throw new Error('Invalid or already started job item');
      job.items[index] = { ...job.items[index], status: 'running' };
    });
  }
  async recordItem(id: string, index: number, item: JobItem): Promise<JobRecord> {
    return this.update(id, job => {
      if (job.status !== 'running' && job.status !== 'cancel_requested') throw new Error('Job is not running');
      if (!Number.isInteger(index) || index < 0 || index >= job.items.length || job.items[index].status !== 'running') throw new Error('Invalid or already completed job item');
      if (item.status !== 'completed' && item.status !== 'failed') throw new Error('Invalid job item result');
      if (item.status === 'failed' && (!item.error || typeof item.error !== 'string')) throw new Error('Failed job item requires an error');
      job.items[index] = { ...item, ...(job.items[index].input === undefined ? {} : { input: job.items[index].input }), ...(job.items[index].progress === undefined ? {} : { progress: job.items[index].progress }) };
    });
  }
  async recordDerivedSnapshot(id: string, index: number, snapshotId: string): Promise<JobRecord> {
    if (!/^[a-f0-9]{64}$/.test(snapshotId)) throw new Error('Invalid derived snapshot ID');
    return this.update(id, job => {
      if (!['running', 'cancel_requested'].includes(job.status) || !Number.isInteger(index) || index < 0 || index >= job.items.length || job.items[index].status !== 'running' || job.items[index].progress) throw new Error('Job item cannot record a derived snapshot');
      job.items[index].progress = { phase: 'derived', snapshotId };
    });
  }
  async finish(id: string, error?: string): Promise<JobRecord> {
    return this.update(id, job => {
      if (job.status !== 'running' && job.status !== 'cancel_requested') throw new Error('Job is not running');
      if (error) { job.status = 'failed'; job.error = error; }
      else if (job.status === 'cancel_requested') job.status = 'cancelled';
      else if (job.items.some(item => item.status === 'pending' || item.status === 'running')) throw new Error('Cannot complete a job with pending items');
      else job.status = 'completed';
    });
  }
  async markInterrupted(): Promise<number> {
    await fs.mkdir(this.directory, { recursive: true });
    let count = 0;
    for (const entry of await fs.readdir(this.directory)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(entry)) continue;
      const id = entry.slice(0, -5);
      await this.update(id, job => { if (!terminal.has(job.status)) { job.status = 'interrupted'; job.items = job.items.map(item => item.status === 'running' ? { ...item, status: 'interrupted' } : item); count++; } });
    }
    return count;
  }

  /** Roots for all persisted nonterminal or interrupted jobs, including pending items. */
  async protectedSnapshotIds(): Promise<Set<string>> {
    let entries: string[];
    try { entries = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set(); throw error; }
    const roots = new Set<string>();
    for (const entry of entries) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(entry)) continue;
      const id = entry.slice(0, -5);
      const job = await this.get(id);
      if (!job || job.id !== id || !['queued', 'running', 'cancel_requested', 'completed', 'cancelled', 'failed', 'interrupted'].includes(job.status) || !Array.isArray(job.items) || job.items.length < 1 || job.items.length > 1000 || job.items.some(item => !item || !['pending', 'running', 'completed', 'failed', 'interrupted'].includes(item.status))) throw new Error('Invalid persisted job');
      if (!['queued', 'running', 'cancel_requested', 'interrupted'].includes(job.status)) continue;
      for (const item of job.items) {
        const input = item?.input as { snapshotId?: unknown } | undefined;
        if (!input || typeof input.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotId)) throw new Error('Persisted job is missing a valid snapshot reference');
        roots.add(input.snapshotId);
        if (item.progress !== undefined) {
          if (item.progress.phase !== 'derived' || !/^[a-f0-9]{64}$/.test(item.progress.snapshotId)) throw new Error('Persisted job has invalid derived snapshot progress');
          roots.add(item.progress.snapshotId);
        }
      }
    }
    return roots;
  }
}
