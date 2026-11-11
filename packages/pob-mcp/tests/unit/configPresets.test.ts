import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalConfigPresetStore } from '../../src/adapters/localBuild/configPresetStore.js';
import { BuildFoundation, type BuildEngine } from '../../src/foundation/buildFoundation.js';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';
import { createConfigPresetCatalogTools, createSnapshotConfigPresetTools } from '../../src/features/configPresets/tools.js';
import type { ConfigPresetStore } from '../../src/ports/configPresets.js';

const id = 'a'.repeat(64), identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3' };
describe('local config presets', () => {
  it('writes and reads presets atomically', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-presets-'));
    try {
      const store = new LocalConfigPresetStore(root);
      expect(await store.list()).toEqual([]);
      const preset = { name: 'boss', sourceSnapshotId: id, sourceIdentity: identity, savedAt: new Date().toISOString(), enemyLevelSetting: { mode: 'automatic' as const }, config: { enemyIsBoss: 'Boss', enemyLevel: 84 } };
      await store.save(preset, false); await expect(store.save(preset, false)).rejects.toThrow();
      expect(await store.list()).toEqual([{ name: 'boss' }]);
      expect((await store.read('boss')).config).toEqual(preset.config);
      await store.save({ ...preset, config: { enemyIsBoss: 'Pinnacle', enemyLevel: 84 } }, true);
      expect((await store.read('boss')).config.enemyIsBoss).toBe('Pinnacle');
      await expect(store.read('../boss')).rejects.toThrow('Invalid');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('distinguishes corrupt or unsafe storage from an empty catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-presets-errors-')), outside = await mkdtemp(path.join(tmpdir(), 'pob-presets-out-'));
    try {
      const store = new LocalConfigPresetStore(root); expect(await store.list()).toEqual([]);
      const dir = path.join(root, '.pob-mcp-presets'); await mkdir(dir); await writeFile(path.join(dir, 'bad.json'), '{');
      await expect(store.read('bad')).rejects.toThrow('invalid JSON');
      await rm(dir, { recursive: true, force: true }); await symlink(outside, path.join(root, '.pob-mcp-presets'));
      await expect(store.list()).rejects.toThrow('not a regular directory');
      await expect(new LocalConfigPresetStore(path.join(root, 'missing')).list()).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
  it('detects a catalog change between pages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-presets-pages-'));
    try {
      const dir = path.join(root, '.pob-mcp-presets'); await mkdir(dir); await writeFile(path.join(dir, 'a.json'), '{}'); await writeFile(path.join(dir, 'b.json'), '{}');
      const tool = createConfigPresetCatalogTools(new LocalConfigPresetStore(root))[0];
      const first = JSON.parse((await tool.invoke({ limit: 1 })).content[0].text); expect(first.nextOffset).toBe(1);
      await writeFile(path.join(dir, 'c.json'), '{}');
      await expect(tool.invoke({ offset: 1, catalog_fingerprint: first.catalogFingerprint })).rejects.toThrow('changed');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('exact snapshot config application', () => {
  it('saves complete snapshot config and delegates exact application without mutating the preset', async () => {
    const preset = { name: 'boss', config: { brandAttachedToEnemy: true, enemyIsBoss: 'Pinnacle', enemyLevel: 84 }, sourceSnapshotId: id, sourceIdentity: identity, savedAt: new Date().toISOString(), enemyLevelSetting: { mode: 'automatic' as const } };
    const save = jest.fn(), read = jest.fn().mockResolvedValue(preset);
    const store = { save, read } as unknown as ConfigPresetStore;
    const runReadOnlySnapshot = jest.fn().mockResolvedValue({ snapshotId: id, identity, warnings: [], result: { config: preset.config, enemyLevelSetting: { mode: 'automatic' } } });
    const deriveExactConfig = jest.fn().mockResolvedValue({ snapshot: { id: 'b'.repeat(64), parentId: id, xml: '<xml/>', ...identity }, changedKeys: ['enemyIsBoss'] });
    const tools = createSnapshotConfigPresetTools({ runReadOnlySnapshot, deriveExactConfig } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveExactConfig'>, store);
    await tools[0].invoke({ snapshot_id: id, name: 'new' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ config: preset.config, sourceSnapshotId: id }), false);
    const report = JSON.parse((await tools[1].invoke({ snapshot_id: id, name: 'boss', trial: true })).content[0].text);
    expect(deriveExactConfig).toHaveBeenCalledWith(id, preset.config, true, { mode: 'automatic' });
    expect(report.snapshot.parentId).toBe(id); expect(report.snapshot.xml).toBeUndefined(); expect(report.identityUnknown.length).toBeGreaterThan(0);
    expect(preset.config).toEqual({ brandAttachedToEnemy: true, enemyIsBoss: 'Pinnacle', enemyLevel: 84 });
  });
  it('skips unchanged obsolete keys and rejects unapplied changes without publishing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-config-exact-'));
    try {
      const store = new SnapshotStore(dir), parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const initial = { brandAttachedToEnemy: true, enemyIsBoss: 'Boss', unrelated: 4 };
      let config: Record<string, string | number | boolean> = { ...initial }, captured = '', corruptReload = false;
      const setConfig = jest.fn(async (changes: Record<string, string | number | boolean>) => {
        const rejected: Record<string, string> = {}, applied: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(changes)) { if (key === 'brandAttachedToEnemy') rejected[key] = 'unknown'; else { config[key] = value; applied[key] = value; } }
        return { rejected, applied };
      });
      const engine = { identity: { engineVersion: null, adapterVersion: null, dataVersion: null }, verifyIdentity: async () => {}, close: async () => {},
        loadBuildXml: async (xml: string) => { config = xml === '<original/>' ? { ...initial } : JSON.parse(captured); if (xml !== '<original/>' && corruptReload) config.brandAttachedToEnemy = false; }, captureSnapshot: async () => { captured = JSON.stringify(config); return { xml: '<derived/>' }; },
        getConfig: async () => ({ ...config }), setConfig, getBuildInfo: async () => ({}), getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}), getStats: async () => ({}) } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveExactConfig(parent.id, { brandAttachedToEnemy: false, enemyIsBoss: 'Pinnacle' })).rejects.toThrow('rejected');
      expect((await readdir(dir)).filter(name => name.endsWith('.json'))).toHaveLength(1);
      const result = await foundation.deriveExactConfig(parent.id, { brandAttachedToEnemy: true, enemyIsBoss: 'Pinnacle' });
      expect(result.changedKeys).toEqual(['enemyIsBoss']); expect(setConfig).toHaveBeenLastCalledWith({ enemyIsBoss: 'Pinnacle' });
      expect(result.snapshot.parentId).toBe(parent.id); expect((await store.read(parent.id)).xml).toBe('<original/>');
      setConfig.mockImplementationOnce(async changes => { config = { ...config, ...changes, unrelated: 99 }; return { rejected: {}, applied: changes }; });
      await expect(foundation.deriveExactConfig(parent.id, { enemyIsBoss: 'Pinnacle' })).rejects.toThrow('unrelated');
      expect((await readdir(dir)).filter(name => name.endsWith('.json'))).toHaveLength(2);
      corruptReload = true;
      await expect(foundation.deriveExactConfig(parent.id, { enemyIsBoss: 'Pinnacle', brandAttachedToEnemy: true })).rejects.toThrow('did not survive');
      expect((await readdir(dir)).filter(name => name.endsWith('.json'))).toHaveLength(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('restores automatic enemy level without fixing the source build’s effective value', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-config-auto-'));
    try {
      const store = new SnapshotStore(dir), parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let levelSetting: { mode: 'automatic' } | { mode: 'explicit'; value: number } = { mode: 'explicit', value: 65 };
      let captured = '';
      const engine = { identity: { engineVersion: null, adapterVersion: null, dataVersion: null }, verifyIdentity: async () => {}, close: async () => {},
        loadBuildXml: async (xml: string) => { levelSetting = xml === '<original/>' ? { mode: 'explicit', value: 65 } : JSON.parse(captured); },
        captureSnapshot: async () => { captured = JSON.stringify(levelSetting); return { xml: '<derived/>' }; },
        getEnemyLevelSetting: async () => levelSetting,
        getConfig: async () => ({ enemyLevel: levelSetting.mode === 'automatic' ? 50 : levelSetting.value, enemyIsBoss: 'None', unrelated: 4 }),
        setConfig: async (changes: Record<string, number>) => { levelSetting = changes.enemyLevel === 0 ? { mode: 'automatic' } : { mode: 'explicit', value: changes.enemyLevel }; return { applied: changes, rejected: {} }; },
        getBuildInfo: async () => ({}), getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}), getStats: async () => ({}) } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      const result = await foundation.deriveExactConfig(parent.id, { enemyLevel: 83, enemyIsBoss: 'None' }, false, { mode: 'automatic' });
      expect(result.changedKeys).toEqual(['enemyLevel']); expect(levelSetting).toEqual({ mode: 'automatic' }); expect((await engine.getConfig() as { enemyLevel: number }).enemyLevel).toBe(50);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
