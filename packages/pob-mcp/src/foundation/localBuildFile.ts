import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveBuildFile } from '../utils/pathSanitizer.js';
import { MAX_BUILD_BYTES } from './shareCode.js';
import { atomicWriteFile } from '../utils/atomicWrite.js';

/** Read a build under the configured directory, resolving symlinks before containment checks. */
export async function readLocalBuild(directory: string, name: string): Promise<string> {
  const root = await fs.realpath(directory);
  const candidate = resolveBuildFile(name, root);
  const resolved = await fs.realpath(candidate);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Build file resolves outside the configured directory');
  const file = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await file.stat()).isFile()) throw new Error('Build path is not a regular file');
    const buffer = Buffer.allocUnsafe(MAX_BUILD_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > MAX_BUILD_BYTES) throw new Error('Build file exceeds the size limit');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)); }
    catch { throw new Error('Build file contains invalid UTF-8'); }
  } finally { await file.close(); }
}

/** Save only inside the configured build directory; parent folders must exist. */
export async function saveLocalBuild(directory: string, name: string, xml: string, overwrite = false): Promise<void> {
  const root = await fs.realpath(directory);
  const requested = resolveBuildFile(name, root);
  const parent = await fs.realpath(path.dirname(requested));
  if (parent !== root && !parent.startsWith(root + path.sep)) throw new Error('Build destination resolves outside the configured directory');
  const destination = path.join(parent, path.basename(requested));
  try {
    const existing = await fs.lstat(destination);
    if (!existing.isFile()) throw new Error('Build destination is not a regular file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWriteFile(destination, xml, overwrite);
}
