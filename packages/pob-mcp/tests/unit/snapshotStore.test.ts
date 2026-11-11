import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';

describe('SnapshotStore', () => {
  it('retains trials by stable ID, protects ancestors and jobs, and collects expired descendants', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-retention-'));
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'));
    try {
      const store = new SnapshotStore(dir);
      const input = { xml: '<build/>', source: 'test', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
      const old = await store.create(input);
      const ancestor = await store.create({ ...input, source: 'ancestor', parentId: old.id }, true);
      const retained = await store.create({ ...input, source: 'retained', parentId: ancestor.id }, true);
      const job = await store.create({ ...input, source: 'job', parentId: old.id }, true);
      const disposable = await store.create({ ...input, source: 'disposable', parentId: old.id }, true);
      const disposableChild = await store.create({ ...input, source: 'child', parentId: disposable.id }, true);
      expect(retained.retention?.expiresAt).toBe('2026-01-08T00:00:00.000Z');
      expect(await store.retain(retained.id)).toEqual({ snapshotId: retained.id, retained: true });
      expect(await store.retain(retained.id)).toEqual({ snapshotId: retained.id, retained: true });
      expect(await store.retentionStatus(retained.id)).toMatchObject({ kind: 'trial', retained: true });
      expect(await store.retentionStatus(old.id)).toMatchObject({ kind: 'durable', retained: false });
      const restarted = new SnapshotStore(dir);
      expect(await restarted.collectExpired(new Set([job.id]), Date.parse('2026-01-08T00:00:00.000Z'))).toEqual([disposableChild.id, disposable.id]);
      await expect(restarted.read(disposable.id)).rejects.toMatchObject({ code: 'ENOENT' });
      for (const snapshot of [old, ancestor, retained, job]) expect((await restarted.read(snapshot.id)).id).toBe(snapshot.id);
    } finally { now.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  });

  it('aborts all collection when any snapshot or retained marker is corrupt', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-retention-'));
    try {
      const store = new SnapshotStore(dir);
      const input = { xml: '<build/>', source: 'test', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
      const one = await store.create(input, true);
      const two = await store.create({ ...input, source: 'other' }, true);
      await store.retain(one.id);
      await writeFile(path.join(dir, 'retained', `${one.id}.json`), '{"id":"wrong"}');
      await expect(store.collectExpired(new Set(), Date.now() + 1000000000)).rejects.toThrow('Invalid retained snapshot marker');
      expect((await store.read(two.id)).id).toBe(two.id);
      await writeFile(path.join(dir, 'retained', `${one.id}.json`), JSON.stringify({ id: one.id }));
      await writeFile(path.join(dir, `${one.id}.json`), '{broken');
      await expect(store.collectExpired(new Set(), Date.now() + 1000000000)).rejects.toThrow();
      expect((await store.read(two.id)).id).toBe(two.id);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('leaves a valid graph if collection fails between child and parent deletion', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-retention-'));
    try {
      const store = new SnapshotStore(dir);
      const input = { xml: '<build/>', source: 'parent', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
      const parent = await store.create(input, true);
      const child = await store.create({ ...input, source: 'child', parentId: parent.id }, true);
      const originalUnlink = fs.unlink.bind(fs);
      let deletes = 0;
      const unlink = jest.spyOn(fs, 'unlink').mockImplementation(async file => {
        if (++deletes === 2) throw new Error('simulated interruption');
        return originalUnlink(file);
      });
      try { await expect(store.collectExpired(new Set(), Date.now() + 1000000000)).rejects.toThrow('simulated interruption'); }
      finally { unlink.mockRestore(); }
      await expect(store.read(child.id)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await store.read(parent.id)).id).toBe(parent.id);
      expect(await store.collectExpired(new Set(), Date.now() + 1000000000)).toEqual([parent.id]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('persists immutable parent and child records and detects corruption', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-snapshot-'));
    try {
      const store = new SnapshotStore(dir);
      const input = { xml: '<build/>', source: 'test', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
      const parent = await store.create(input);
      expect(await store.create(input)).toEqual(parent);
      const child = await store.create({ ...input, xml: '<build level="2"/>', parentId: parent.id });
      expect((await store.read(child.id)).parentId).toBe(parent.id);
      expect((await store.read(parent.id)).xml).toBe(input.xml);
      await expect(store.read('../outside')).rejects.toThrow('Invalid snapshot ID');
      const file = path.join(dir, `${child.id}.json`);
      await writeFile(file, (await readFile(file, 'utf8')).replace('level=', 'changed='));
      await expect(store.read(child.id)).rejects.toThrow('integrity');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('lists verified metadata in deterministic pages without exporting XML', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-snapshot-'));
    try {
      const store = new SnapshotStore(dir);
      const input = { xml: '<build/>', source: 'test', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
      const first = await store.create(input);
      const second = await store.create({ ...input, source: 'another' });
      const page = await store.list(1);
      expect(page.snapshots).toHaveLength(1);
      expect(page.snapshots[0]).not.toHaveProperty('xml');
      expect(page.nextCursor).toBe(page.snapshots[0].id);
      const next = await store.list(1, page.nextCursor!);
      expect([page.snapshots[0].id, next.snapshots[0].id].sort()).toEqual([first.id, second.id].sort());
      expect(next.nextCursor).toBeNull();
      await expect(store.list(1, '../bad')).rejects.toThrow('cursor');
      await expect(store.list(51)).rejects.toThrow('limit');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
