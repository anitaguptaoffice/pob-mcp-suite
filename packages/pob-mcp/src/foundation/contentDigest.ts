import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

/** Hash paths and bytes, not timestamps, with a stable traversal order. */
export async function digestDirectory(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(relative: string): Promise<void> {
    const directory = path.join(root, relative);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Cannot fingerprint symbolic link: ${name}`);
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile()) throw new Error(`Cannot fingerprint non-file: ${name}`);
      const before = await fs.stat(target);
      hash.update(JSON.stringify([name, before.size]) + '\n');
      for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
      const after = await fs.stat(target);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
        throw new Error(`File changed while fingerprinting: ${name}`);
      }
    }
  }
  await visit('');
  return `sha256:${hash.digest('hex')}`;
}
