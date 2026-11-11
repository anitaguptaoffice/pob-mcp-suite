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

/** Save only inside the configured build directory; parent folders must exist unless explicitly created. */
export async function saveLocalBuild(directory: string, name: string, xml: string, overwrite = false, createDirectories = false): Promise<void> {
  const root = await fs.realpath(directory);
  const requested = resolveBuildFile(name, root);
  if (createDirectories) {
    if (process.platform !== 'linux') throw new Error('Secure directory creation requires Linux /proc/self/fd');
    try { await fs.access('/proc/self/fd'); } catch { throw new Error('Secure directory creation requires Linux /proc/self/fd'); }
    const parts = path.relative(root, path.dirname(requested)).split(path.sep).filter(Boolean);
    if (parts.length > 32) throw new Error('Build destination has too many directory levels');
    const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
    let current = await fs.open(root, flags);
    try {
      for (const part of parts) {
        const anchored = `/proc/self/fd/${current.fd}/${part}`;
        try { await fs.mkdir(anchored); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        let next;
        try { next = await fs.open(anchored, flags); }
        catch (error) { throw new Error('Build destination contains a symlink or non-directory component', { cause: error }); }
        await current.close(); current = next;
      }
      const destination = `/proc/self/fd/${current.fd}/${path.basename(requested)}`;
      try {
        const existing = await fs.lstat(destination);
        if (!existing.isFile()) throw new Error('Build destination is not a regular file');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await atomicWriteFile(destination, xml, overwrite);
      return;
    } finally { await current.close(); }
  }
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
