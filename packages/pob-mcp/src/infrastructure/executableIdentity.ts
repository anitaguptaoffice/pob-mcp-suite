import { constants, createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Resolve executable as the child process sees it. Windows resolution remains unknown. */
export async function resolveExecutable(command: string, cwd: string, envPath = process.env.PATH ?? ''): Promise<string | null> {
  if (process.platform === 'win32') return null;
  const candidates = command.includes('/') ? [path.resolve(cwd, command)]
    : envPath.split(path.delimiter).map(part => path.resolve(cwd, part || '.', command));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, constants.X_OK);
      const resolved = await fs.realpath(candidate);
      if ((await fs.stat(resolved)).isFile()) return resolved;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'ENOTDIR') throw error;
    }
  }
  throw new Error(`PoB executable not found: ${command}`);
}

export async function digestExecutable(file: string): Promise<string> {
  const before = await fs.stat(file);
  if (!before.isFile()) throw new Error('PoB executable is not a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  const after = await fs.stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('PoB executable changed during fingerprinting');
  return `sha256:${hash.digest('hex')}`;
}
