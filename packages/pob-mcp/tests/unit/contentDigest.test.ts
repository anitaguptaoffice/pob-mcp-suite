import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { digestDirectory } from '../../src/infrastructure/contentDigest.js';

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

  it('leaves engine-written caches out of identity while still tracking its inputs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-digest-'));
    try {
      await mkdir(path.join(dir, 'Data', 'TimelessJewelData'), { recursive: true });
      await writeFile(path.join(dir, 'Data', 'TimelessJewelData', 'ElegantHubris.zip'), 'pinned');
      const ignoreCache = (name: string): boolean => /^Data\/TimelessJewelData\/[^/]+\.bin$/.test(name);
      const digest = (): Promise<string> => digestDirectory(dir, { ignore: ignoreCache });
      const original = await digest();
      // The engine writing its own cache must not look like a changed checkout…
      await writeFile(path.join(dir, 'Data', 'TimelessJewelData', 'ElegantHubris.bin'), 'decompressed');
      expect(await digest()).toBe(original);
      // …while a change to the pinned input still does.
      await writeFile(path.join(dir, 'Data', 'TimelessJewelData', 'ElegantHubris.zip'), 'updated');
      expect(await digest()).not.toBe(original);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
