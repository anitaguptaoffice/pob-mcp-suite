import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readLocalBuild, saveLocalBuild } from '../../src/foundation/localBuildFile.js';
import { MAX_BUILD_BYTES } from '../../src/foundation/shareCode.js';

describe('local build import', () => {
  it('reads a named nested build, but rejects escaping paths, oversized data and invalid UTF-8', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-local-build-'));
    try {
      const root = path.join(dir, 'builds');
      await mkdir(path.join(root, 'nested'), { recursive: true });
      await writeFile(path.join(root, 'nested', 'one.xml'), '<build/>');
      expect(await readLocalBuild(root, 'nested/one')).toBe('<build/>');
      await expect(readLocalBuild(root, '../outside')).rejects.toThrow('traversal');
      await writeFile(path.join(dir, 'outside.xml'), '<outside/>');
      if (process.platform !== 'win32') {
        await symlink(path.join(dir, 'outside.xml'), path.join(root, 'link.xml'));
        await expect(readLocalBuild(root, 'link')).rejects.toThrow('outside');
      }
      await writeFile(path.join(root, 'invalid.xml'), Buffer.from([0xff]));
      await expect(readLocalBuild(root, 'invalid')).rejects.toThrow('UTF-8');
      await writeFile(path.join(root, 'large.xml'), Buffer.alloc(MAX_BUILD_BYTES + 1));
      await expect(readLocalBuild(root, 'large')).rejects.toThrow('size limit');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('requires explicit overwrite and keeps writes inside the build directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-local-save-'));
    try {
      const root = path.join(dir, 'builds');
      await mkdir(root);
      await saveLocalBuild(root, 'test', '<first/>');
      await expect(saveLocalBuild(root, 'test', '<second/>')).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readLocalBuild(root, 'test')).toBe('<first/>');
      const concurrent = await Promise.allSettled([
        saveLocalBuild(root, 'race', '<a/>'), saveLocalBuild(root, 'race', '<b/>'),
      ]);
      expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(['<a/>', '<b/>']).toContain(await readLocalBuild(root, 'race'));

      await saveLocalBuild(root, 'test', '<second/>', true);
      expect(await readLocalBuild(root, 'test')).toBe('<second/>');
      await expect(saveLocalBuild(root, '../escape', '<x/>', true)).rejects.toThrow('traversal');
      if (process.platform !== 'win32') {
        await symlink(dir, path.join(root, 'outside'));
        await expect(saveLocalBuild(root, 'outside/x', '<x/>', true)).rejects.toThrow('outside');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('creates explicitly requested directories without following symlinks or overwriting files', async () => {
    if (process.platform !== 'linux') return;
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-local-mkdir-'));
    try {
      const root = path.join(dir, 'builds'); await mkdir(root);
      await expect(saveLocalBuild(root, 'new/league/build', '<first/>')).rejects.toMatchObject({ code: 'ENOENT' });
      await saveLocalBuild(root, 'new/league/build', '<first/>', false, true);
      expect(await readLocalBuild(root, 'new/league/build')).toBe('<first/>');
      await expect(saveLocalBuild(root, 'new/league/build', '<second/>', false, true)).rejects.toMatchObject({ code: 'EEXIST' });
      await saveLocalBuild(root, 'new/league/build', '<second/>', true, true);
      expect(await readLocalBuild(root, 'new/league/build')).toBe('<second/>');
      await symlink(dir, path.join(root, 'escape'));
      await expect(saveLocalBuild(root, 'escape/created/build', '<outside/>', false, true)).rejects.toThrow('symlink or non-directory');
      await expect(saveLocalBuild(root, '../escape', '<outside/>', false, true)).rejects.toThrow('traversal');
      await expect(readLocalBuild(dir, 'created/build')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
