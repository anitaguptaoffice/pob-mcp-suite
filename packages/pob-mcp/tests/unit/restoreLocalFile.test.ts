import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectLocalFile, restoreLocalFile } from '../../src/foundation/restoreLocalFile.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const snapshotId = 'a'.repeat(64), backupId = 'b'.repeat(64);

it('backs up observed content and refuses a file changed during backup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pob-restore-'));
  try {
    const file = path.join(dir, 'build.xml'); await writeFile(file, '<old/>');
    const info = await inspectLocalFile(dir, 'build');
    const importBuild = jest.fn(async (xml: string) => { await writeFile(file, '<external/>'); return { id: backupId, xml }; });
    const foundation = { exportBuild: async () => '<restored/>', importBuild, saveHistory: jest.fn(async () => ({})), retainSnapshot: jest.fn(async () => ({})) } as unknown as BuildFoundation;
    await expect(restoreLocalFile(foundation, dir, snapshotId, 'build', info.sha256, true)).rejects.toThrow(`backup snapshot ${backupId}`);
    expect(importBuild).toHaveBeenCalledWith('<old/>', 'restore-backup:build');
    expect(await readFile(file, 'utf8')).toBe('<external/>');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('serializes competing restores and refuses a stale fingerprint', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pob-restore-lock-'));
  try {
    const file = path.join(dir, 'build.xml'); await writeFile(file, '<old/>');
    const info = await inspectLocalFile(dir, 'build');
    const foundation = { exportBuild: async () => '<new/>', importBuild: async () => ({ id: backupId }), saveHistory: async () => ({}), retainSnapshot: async () => ({}) } as unknown as BuildFoundation;
    const results = await Promise.allSettled([restoreLocalFile(foundation, dir, snapshotId, 'build', info.sha256, true), restoreLocalFile(foundation, dir, snapshotId, 'build.xml', info.sha256, true)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toBe('<new/>');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('only skips backup when explicitly requested and reports backup-history failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pob-restore-optional-'));
  try {
    const file = path.join(dir, 'build.xml'); await writeFile(file, '<old/>');
    const info = await inspectLocalFile(dir, 'build');
    const importBuild = jest.fn(async () => ({ id: backupId }));
    const foundation = { exportBuild: async () => '<new/>', importBuild, saveHistory: async () => { throw new Error('disk error'); }, retainSnapshot: async () => ({}) } as unknown as BuildFoundation;
    await expect(restoreLocalFile(foundation, dir, snapshotId, 'build', info.sha256, true)).rejects.toThrow(`Backup snapshot ${backupId}`);
    expect(await readFile(file, 'utf8')).toBe('<old/>');
    const result = await restoreLocalFile(foundation, dir, snapshotId, 'build', info.sha256, false);
    expect(result.backupSnapshotId).toBeNull(); expect(importBuild).toHaveBeenCalledTimes(1);
    expect(await readFile(file, 'utf8')).toBe('<new/>');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
