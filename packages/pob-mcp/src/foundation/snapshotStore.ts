import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../utils/atomicWrite.js';
import { DEFAULT_TRIAL_TTL_MS, planSnapshotCollection, type TrialRetention } from './snapshotRetention.js';

/** Snapshot format is provisional until PoB round-trip coverage is established. */
export interface SnapshotRecord {
  formatVersion: 1;
  id: string;
  parentId: string | null;
  xml: string;
  source: string;
  engineVersion: string | null;
  dataVersion: string | null;
  adapterVersion: string | null;
  runtimeVersion?: string | null;
  executableVersion?: string | null;
  limitations: string[];
  retention?: TrialRetention;
}

export type SnapshotMetadata = Omit<SnapshotRecord, 'xml'>;
export interface SnapshotHistoryInput {
  buildName: string;
  tag: string;
  description: string;
  recordedAt: string | null;
}
export type SnapshotHistoryRecord = SnapshotHistoryInput & { formatVersion: 1; snapshotId: string; id: string };
export function snapshotMetadata(record: SnapshotRecord): SnapshotMetadata {
  const { xml: _xml, ...metadata } = record;
  return metadata;
}

type SnapshotInput = Omit<SnapshotRecord, 'id' | 'formatVersion' | 'limitations'>;

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export class SnapshotStore {
  constructor(private readonly directory: string) {}

  async create(input: SnapshotInput, trial = false): Promise<SnapshotRecord> {
    if (!input.xml.trim() || !input.source.trim()) throw new Error('XML and source are required');
    if (input.retention !== undefined) throw new Error('Retention metadata is assigned by the store');
    if (typeof trial !== 'boolean') throw new Error('Invalid trial flag');
    if (input.parentId) await this.read(input.parentId);
    const body = { formatVersion: 1 as const, ...input,
      ...(trial ? { retention: { kind: 'trial' as const, expiresAt: new Date(Date.now() + DEFAULT_TRIAL_TTL_MS).toISOString() } } : {}),
      limitations: ['XML round-trip fidelity and external dependencies have not been fully verified.',
        'Fingerprints do not cover external dependencies or the interpreter of an executable wrapper.'] };
    const id = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const record = { ...body, id };
    await fs.mkdir(this.directory, { recursive: true });
    try {
      await atomicWriteFile(path.join(this.directory, `${id}.json`), JSON.stringify(record), false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await this.read(id);
    }
    await syncDirectory(this.directory);
    return record;
  }

  async list(limit = 20, after?: string): Promise<{ snapshots: SnapshotMetadata[]; nextCursor: string | null }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Snapshot limit must be between 1 and 50');
    if (after !== undefined && !/^[a-f0-9]{64}$/.test(after)) throw new Error('Invalid snapshot cursor');
    let names: string[];
    try { names = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { snapshots: [], nextCursor: null }; throw error; }
    const ids = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => name.slice(0, -5)).sort();
    const selected = ids.filter(id => !after || id > after).slice(0, limit + 1);
    const page = selected.slice(0, limit);
    return { snapshots: (await Promise.all(page.map(id => this.read(id)))).map(snapshotMetadata),
      nextCursor: selected.length > limit ? page[page.length - 1] : null };
  }

  async read(id: string): Promise<SnapshotRecord> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid snapshot ID');
    const record = JSON.parse(await fs.readFile(path.join(this.directory, `${id}.json`), 'utf8')) as SnapshotRecord;
    const { id: storedId, ...body } = record;
    if (storedId !== id || createHash('sha256').update(JSON.stringify(body)).digest('hex') !== id) {
      throw new Error('Snapshot integrity check failed');
    }
    return record;
  }

  /** Mark a snapshot durable without changing its content-addressed ID. */
  async retain(id: string): Promise<{ snapshotId: string; retained: true }> {
    await this.read(id);
    const directory = path.join(this.directory, 'retained');
    await fs.mkdir(directory, { recursive: true });
    await syncDirectory(this.directory);
    const file = path.join(directory, `${id}.json`);
    try { await atomicWriteFile(file, JSON.stringify({ id }), false); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await this.readRetainedMarker(id);
    }
    await syncDirectory(directory);
    return { snapshotId: id, retained: true };
  }

  private async readRetainedMarker(id: string): Promise<void> {
    const marker = JSON.parse(await fs.readFile(path.join(this.directory, 'retained', `${id}.json`), 'utf8'));
    if (!marker || typeof marker !== 'object' || Array.isArray(marker) || Object.keys(marker).length !== 1 || marker.id !== id) throw new Error('Invalid retained snapshot marker');
  }

  async retentionStatus(id: string): Promise<{ snapshotId: string; kind: 'durable' | 'trial'; expiresAt: string | null; retained: boolean }> {
    const record = await this.read(id);
    let retained = false;
    try { await this.readRetainedMarker(id); retained = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { snapshotId: id, kind: record.retention?.kind ?? 'durable', expiresAt: record.retention?.expiresAt ?? null, retained };
  }

  /** History is separate from immutable snapshot contents; retain before publishing a reference. */
  async saveHistory(snapshotId: string, input: SnapshotHistoryInput): Promise<SnapshotHistoryRecord> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['buildName', 'tag', 'description', 'recordedAt'].includes(key)) ||
        typeof input.buildName !== 'string' || !input.buildName.trim() || input.buildName.length > 1000 || typeof input.tag !== 'string' || input.tag.length > 1000 || typeof input.description !== 'string' || input.description.length > 10000 || (input.recordedAt !== null && (typeof input.recordedAt !== 'string' || input.recordedAt.length > 100))) throw new Error('Invalid snapshot history');
    const body = { formatVersion: 1 as const, snapshotId, ...input };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > 131072) throw new Error('Snapshot history exceeds the size limit');
    const id = createHash('sha256').update(serialized).digest('hex');
    await this.retain(snapshotId);
    const directory = path.join(this.directory, 'history');
    await fs.mkdir(directory, { recursive: true });
    await syncDirectory(this.directory);
    const record = { ...body, id };
    try { await atomicWriteFile(path.join(directory, `${id}.json`), JSON.stringify(record), false); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await this.readHistory(id); }
    await syncDirectory(directory);
    return record;
  }

  async readHistory(id: string): Promise<SnapshotHistoryRecord> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid history ID');
    const record = JSON.parse(await fs.readFile(path.join(this.directory, 'history', `${id}.json`), 'utf8')) as SnapshotHistoryRecord;
    const { id: storedId, ...body } = record;
    if (storedId !== id || createHash('sha256').update(JSON.stringify(body)).digest('hex') !== id || body.formatVersion !== 1 || !/^[a-f0-9]{64}$/.test(body.snapshotId)) throw new Error('Snapshot history integrity check failed');
    return record;
  }

  async listHistory(): Promise<SnapshotHistoryRecord[]> {
    let names: string[];
    try { names = await fs.readdir(path.join(this.directory, 'history')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new Error('Invalid snapshot history filename');
    if (names.length > 10000) throw new Error('Snapshot history exceeds the listing limit');
    return Promise.all(names.sort().map(name => this.readHistory(name.slice(0, -5))));
  }

  /** Only call under exclusive store ownership, before accepting requests. */
  async collectExpired(protectedIds: ReadonlySet<string>, now = Date.now()): Promise<string[]> {
    let names: string[];
    try { names = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const ids = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => name.slice(0, -5));
    const nodes = await Promise.all(ids.map(id => this.read(id)));
    let markers: string[];
    try { markers = await fs.readdir(path.join(this.directory, 'retained')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') markers = []; else throw error; }
    if (markers.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new Error('Invalid retained snapshot marker filename');
    const retained = new Set(markers.map(name => name.slice(0, -5)));
    for (const id of retained) await this.readRetainedMarker(id);
    const plan = planSnapshotCollection(nodes, retained, protectedIds, now);
    for (const id of plan) {
      await fs.unlink(path.join(this.directory, `${id}.json`));
      await syncDirectory(this.directory);
    }
    return plan;
  }
}
