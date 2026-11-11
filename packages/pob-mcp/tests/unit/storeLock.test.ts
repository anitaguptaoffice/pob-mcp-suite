import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireStoreLock } from '../../src/foundation/storeLock.js';

describe('snapshot store lock', () => {
  it('permits one writer, releases cleanly and does not delete a replaced lock', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-lock-'));
    try {
      const release = await acquireStoreLock(dir);
      await expect(acquireStoreLock(dir)).rejects.toThrow('locked');
      await release();
      await release();
      const second = await acquireStoreLock(dir);
      await writeFile(path.join(dir, '.writer.lock'), JSON.stringify({ token: 'different' }));
      await expect(second()).rejects.toThrow('ownership changed');
      await expect(acquireStoreLock(dir)).rejects.toThrow('locked');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('preserves unrecognized, invalid and foreign-guard markers rather than guessing from a PID', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-unrecognized-lock-'));
    try {
      for (const marker of ['', '{', JSON.stringify({ token: 'unrecognized', pid: 99999999 }), JSON.stringify({ protocol: 'pob-mcp/flock-v1', token: 'a'.repeat(36), guard: { dev: '0', ino: '0' } })]) {
        await writeFile(path.join(dir, '.writer.lock'), marker);
        await expect(acquireStoreLock(dir)).rejects.toThrow('ambiguous or unrecognized');
        expect(await readFile(path.join(dir, '.writer.lock'), 'utf8')).toBe(marker);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('keeps the same guard inode across clean releases', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-guard-'));
    try {
      const first = await acquireStoreLock(dir);
      const inode = (await stat(path.join(dir, '.writer.guard'))).ino;
      await first();
      const second = await acquireStoreLock(dir);
      expect((await stat(path.join(dir, '.writer.guard'))).ino).toBe(inode);
      await second();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
