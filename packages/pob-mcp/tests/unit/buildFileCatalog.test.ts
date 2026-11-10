import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalBuildFileCatalog } from '../../src/adapters/localBuild/fileCatalog.js';
import { createBuildFileCatalogTool } from '../../src/features/localBuildCatalog/tool.js';

describe('local build file catalog', () => {
  it('lists nested files deterministically, rejects stale cursors and never follows symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-catalog-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'pob-outside-'));
    try {
      await mkdir(path.join(root, 'league')); await mkdir(path.join(root, '.hidden'));
      await writeFile(path.join(root, 'z.xml'), '<z/>'); await writeFile(path.join(root, 'league', 'a.XML'), '<a/>');
      await writeFile(path.join(root, '.hidden', 'secret.xml'), '<hidden/>'); await writeFile(path.join(root, '~~temp~~x.xml'), '<temp/>');
      await writeFile(path.join(outside, 'outside.xml'), '<outside/>'); await symlink(outside, path.join(root, 'external'));
      await symlink(path.join(outside, 'outside.xml'), path.join(root, 'link.xml'));
      const tool = createBuildFileCatalogTool(new LocalBuildFileCatalog(root));
      const call = async (args: Record<string, unknown>) => JSON.parse((await tool.invoke(args)).content[0].text);
      const first = await call({ limit: 1 });
      expect(first).toMatchObject({ complete: true, totalObserved: 2, names: [path.join('league', 'a.XML')], nextCursor: path.join('league', 'a.XML') });
      const second = await call({ limit: 1, after: first.nextCursor, catalog_fingerprint: first.catalogFingerprint });
      expect(second.names).toEqual(['z.xml']); expect(second.nextCursor).toBeNull();
      await writeFile(path.join(root, 'new.xml'), '<new/>');
      await expect(call({ after: first.nextCursor, catalog_fingerprint: first.catalogFingerprint })).rejects.toThrow('changed');
      await expect(call({ after: first.nextCursor })).rejects.toThrow('pagination');
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
  it('reports traversal bounds as incomplete and missing roots as errors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-catalog-limits-'));
    try {
      await mkdir(path.join(root, 'nested')); await writeFile(path.join(root, 'nested', 'a.xml'), '<a/>');
      const bounded = await new LocalBuildFileCatalog(root, 100, 0).scan();
      expect(bounded.complete).toBe(false); expect(bounded.issues).toEqual([{ path: 'nested', reason: 'DEPTH_LIMIT' }]);
      await expect(new LocalBuildFileCatalog(path.join(root, 'missing')).scan()).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
