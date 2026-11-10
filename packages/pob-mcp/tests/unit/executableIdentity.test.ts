import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digestExecutable, resolveExecutable } from '../../src/foundation/executableIdentity.js';

describe('PoB executable identity', () => {
  it('resolves PATH relative to child cwd and fingerprints the actual symlink target', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-exec-'));
    try {
      await mkdir(path.join(dir, 'bin'));
      const actual = path.join(dir, 'bin', 'real');
      await writeFile(actual, 'first');
      await chmod(actual, 0o755);
      await symlink('real', path.join(dir, 'bin', 'lua'));
      const executable = await resolveExecutable('lua', dir, 'missing:bin');
      expect(executable).toBe(actual);
      const before = await digestExecutable(executable!);
      await writeFile(actual, 'other');
      expect(await digestExecutable(executable!)).not.toBe(before);
      await expect(resolveExecutable('absent', dir, 'bin')).rejects.toThrow('not found');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
