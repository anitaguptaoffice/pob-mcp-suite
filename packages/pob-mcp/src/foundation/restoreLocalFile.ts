import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BuildFoundation } from './buildFoundation.js';
import { readLocalBuild, saveLocalBuild } from './localBuildFile.js';
import { resolveBuildFile } from '../utils/pathSanitizer.js';

const digest = (xml: string) => createHash('sha256').update(xml, 'utf8').digest('hex');
const locks = new Map<string, Promise<unknown>>();

export async function inspectLocalFile(directory: string, buildName: string) {
  const xml = await readLocalBuild(directory, buildName);
  return { buildName, sha256: digest(xml), sizeBytes: Buffer.byteLength(xml, 'utf8'), warnings: ['The file can change after inspection.'] };
}

/** Requires an existing file and an explicit digest observed by the caller. */
export async function restoreLocalFile(foundation: Pick<BuildFoundation, 'exportBuild' | 'importBuild' | 'saveHistory' | 'retainSnapshot'>, directory: string, snapshotId: string, buildName: string, expectedDigest: string, backup: boolean) {
  if (!/^[a-f0-9]{64}$/.test(snapshotId) || !/^[a-f0-9]{64}$/.test(expectedDigest) || typeof backup !== 'boolean') throw new Error('Invalid restore options');
  const root = await fs.realpath(directory);
  const key = await fs.realpath(resolveBuildFile(buildName, root));
  if (!key.startsWith(root + path.sep)) throw new Error('Build file resolves outside the configured directory');
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => restoreLocked(foundation, directory, snapshotId, buildName, expectedDigest, backup));
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

async function restoreLocked(foundation: Pick<BuildFoundation, 'exportBuild' | 'importBuild' | 'saveHistory' | 'retainSnapshot'>, directory: string, snapshotId: string, buildName: string, expectedDigest: string, backup: boolean) {
  const xml = await foundation.exportBuild(snapshotId);
  const current = await readLocalBuild(directory, buildName);
  if (digest(current) !== expectedDigest) throw new Error('Build file changed since inspection; no overwrite was attempted');
  let backupId: string | null = null;
  if (backup) {
    const saved = await foundation.importBuild(current, `restore-backup:${buildName}`);
    backupId = saved.id;
    try { await foundation.saveHistory(saved.id, { buildName, tag: 'before-restore', description: `Before restoring snapshot ${snapshotId}`, recordedAt: new Date().toISOString() }); }
    catch (error) { throw new Error(`Backup snapshot ${saved.id} was created, but backup history failed; no overwrite was attempted: ${error instanceof Error ? error.message : String(error)}`); }
  }
  try { await foundation.retainSnapshot(snapshotId); }
  catch (error) { throw new Error(`Could not retain restore snapshot; no overwrite was attempted${backupId ? `; backup snapshot ${backupId}` : ''}: ${error instanceof Error ? error.message : String(error)}`); }
  let checked: string;
  try { checked = await readLocalBuild(directory, buildName); }
  catch (error) { throw new Error(`Build file could not be rechecked; no overwrite was attempted${backupId ? `; backup snapshot ${backupId}` : ''}: ${error instanceof Error ? error.message : String(error)}`); }
  if (digest(checked) !== expectedDigest) throw new Error(`Build file changed during restore; no overwrite was attempted${backupId ? `; backup snapshot ${backupId}` : ''}`);
  try { await saveLocalBuild(directory, buildName, xml, true); }
  catch (error) { throw new Error(`Restore write failed${backupId ? `; backup snapshot ${backupId}` : ''}: ${error instanceof Error ? error.message : String(error)}`); }
  return { snapshotId, buildName, restoredSha256: digest(xml), previousSha256: expectedDigest, backupSnapshotId: backupId, retained: true,
    warnings: ['The destination is checked before writing, but other writes can still change it between the final check and replacement.', 'The snapshot and any open PoB session are not modified; reload the file explicitly.'] };
}
