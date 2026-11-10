import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { digestDirectory } from '../../src/foundation/contentDigest.js';

describe('digestDirectory', () => {
  it('tracks content and paths, and rejects untracked symlink targets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-digest-'));
    try {
      await mkdir(path.join(dir, 'data'));
      await writeFile(path.join(dir, 'data', 'one'), 'first');
      const original = await digestDirectory(dir);
      expect(await digestDirectory(dir)).toBe(original);
      await writeFile(path.join(dir, 'data', 'one'), 'other');
      expect(await digestDirectory(dir)).not.toBe(original);
      await symlink('data/one', path.join(dir, 'link'));
      await expect(digestDirectory(dir)).rejects.toThrow('symbolic link');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
