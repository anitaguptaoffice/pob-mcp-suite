import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';
import { invokeFoundation } from '../../src/foundation/mcpTools.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

it('retains a trial and stores immutable, idempotent history separately from snapshot content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pob-snapshot-history-'));
  try {
    const store = new SnapshotStore(dir);
    const snapshot = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null }, true);
    const history = { buildName: 'build', tag: 'before', description: 'old description', recordedAt: '2024-01-01' };
    const saved = await store.saveHistory(snapshot.id, history);
    expect(await store.saveHistory(snapshot.id, history)).toEqual(saved);
    expect((await store.retentionStatus(snapshot.id)).retained).toBe(true);
    expect(await store.collectExpired(new Set(), Date.now() + 30 * 86400000)).toEqual([]);
    expect((await store.listHistory())[0]).toEqual(saved);
    expect((await store.readHistory(saved.id)).description).toBe('old description');
    await writeFile(path.join(dir, 'history', `${saved.id}.json`), JSON.stringify({ ...saved, tag: 'altered' }));
    await expect(store.listHistory()).rejects.toThrow('integrity check');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('filters saved history and rejects pagination after a concurrent addition', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pob-history-pages-'));
  try {
    const store = new SnapshotStore(dir);
    const snapshot = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
    const foundation = { saveHistory: store.saveHistory.bind(store), listHistory: store.listHistory.bind(store) } as unknown as BuildFoundation;
    await store.saveHistory(snapshot.id, { buildName: 'build', tag: 'x', description: 'a', recordedAt: null });
    await store.saveHistory(snapshot.id, { buildName: 'build', tag: 'x', description: 'b', recordedAt: null });
    await store.saveHistory(snapshot.id, { buildName: 'other', tag: 'x', description: 'c', recordedAt: null });
    const first = await invokeFoundation(foundation, 'list_snapshot_history', { build_name: 'build', tag: 'x', limit: 1 }) as any;
    expect(first.total).toBe(2); expect(first.nextCursor).toBe(1);
    await store.saveHistory(snapshot.id, { buildName: 'build', tag: 'x', description: 'new', recordedAt: null });
    await expect(invokeFoundation(foundation, 'list_snapshot_history', { build_name: 'build', tag: 'x', limit: 1, after: 1, catalog_fingerprint: first.catalogFingerprint })).rejects.toThrow('restart pagination');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
