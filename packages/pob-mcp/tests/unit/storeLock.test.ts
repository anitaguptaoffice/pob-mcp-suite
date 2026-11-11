import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
