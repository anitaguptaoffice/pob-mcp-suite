import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listLegacyHistory, readLegacyHistory } from '../../src/foundation/legacyHistory.js';
import { invokeFoundation } from '../../src/foundation/mcpTools.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

describe('legacy build history', () => {
  it('reads both legacy directory conventions and preserves metadata and original XML', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-history-'));
    try {
      const folder = path.join(root, '.pob-mcp', 'snapshots', 'build.xml');
      const olderFolder = path.join(root, '.pob-mcp', 'snapshots', 'build');
      await mkdir(folder, { recursive: true }); await mkdir(olderFolder, { recursive: true });
      const metadata = JSON.stringify({ timestamp: '2024-01-01', originalBuild: 'build', tag: 'My Tag', description: 'saved', statsSnapshot: { life: 123, dps: 42 } });
      await writeFile(path.join(folder, 'abc_metadata.json'), metadata);
      await writeFile(path.join(folder, 'abc_my-tag.xml'), '<build/>');
      await writeFile(path.join(olderFolder, 'abc_metadata.json'), metadata);
      await writeFile(path.join(olderFolder, 'abc_my-tag.xml'), '<old/>');
      const catalog = await listLegacyHistory(root, 'build');
      expect(catalog.complete).toBe(true); expect(catalog.entries).toHaveLength(2);
      const selected = catalog.entries.find(entry => entry.origin === 'build.xml')!;
      const result = await readLegacyHistory(root, 'build', selected.origin, selected.id, selected.metadataDigest);
      expect(result.xml).toBe('<build/>'); expect(result.metadata).toEqual(JSON.parse(metadata));
      expect(await readFile(path.join(folder, 'abc_metadata.json'), 'utf8')).toBe(metadata);
      expect(await readdir(folder)).toHaveLength(2);
      await writeFile(path.join(folder, 'abc_metadata.json'), metadata.replace('saved', 'changed'));
      await expect(readLegacyHistory(root, 'build', selected.origin, selected.id, selected.metadataDigest)).rejects.toThrow('metadata changed');
      await expect(listLegacyHistory(root, '../outside')).rejects.toThrow('path traversal');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('reports missing XML and corrupt metadata as incomplete rather than hiding failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-history-errors-'));
    try {
      const folder = path.join(root, '.pob-mcp', 'snapshots', 'build.xml'); await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'broken_metadata.json'), '{');
      await writeFile(path.join(folder, 'missing_metadata.json'), JSON.stringify({ tag: 'x' }));
      await writeFile(path.join(folder, 'orphan_saved.xml'), '<build/>');
      const catalog = await listLegacyHistory(root, 'build');
      expect(catalog.complete).toBe(false); expect(catalog.entries).toEqual([]); expect(catalog.issues).toHaveLength(3);
      expect(catalog.issues.some(issue => issue.reason === 'XML_WITHOUT_READABLE_METADATA')).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('detects changed catalogs when paging and imports the selected content explicitly', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-history-tools-'));
    try {
      const folder = path.join(root, '.pob-mcp', 'snapshots', 'build.xml'); await mkdir(folder, { recursive: true });
      for (const id of ['a', 'b']) {
        await writeFile(path.join(folder, `${id}_metadata.json`), JSON.stringify({ tag: 'saved', description: id }));
        await writeFile(path.join(folder, `${id}_saved.xml`), `<build>${id}</build>`);
      }
      const importBuild = jest.fn(async (xml: string, source: string) => ({ id: 'snapshot', xml, source }));
      const foundation = { importBuild } as unknown as BuildFoundation;
      const first = await invokeFoundation(foundation, 'list_legacy_build_history', { build_name: 'build', limit: 1 }, undefined, root) as any;
      expect(first.nextCursor).toBe(1); expect(first.entries[0].id).toBe('a');
      const imported = await invokeFoundation(foundation, 'import_legacy_build_history', { build_name: 'build', origin: first.entries[0].origin, legacy_id: 'a', metadata_digest: first.entries[0].metadataDigest }, undefined, root) as any;
      expect(importBuild).toHaveBeenCalledWith('<build>a</build>', expect.stringContaining('legacy-history:'));
      expect(imported.snapshot).not.toHaveProperty('xml'); expect(imported.legacy.metadata.description).toBe('a');
      await writeFile(path.join(folder, 'b_metadata.json'), JSON.stringify({ tag: 'saved', description: 'changed' }));
      await expect(invokeFoundation(foundation, 'list_legacy_build_history', { build_name: 'build', limit: 1, after: 1, catalog_fingerprint: first.catalogFingerprint }, undefined, root)).rejects.toThrow('restart pagination');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
