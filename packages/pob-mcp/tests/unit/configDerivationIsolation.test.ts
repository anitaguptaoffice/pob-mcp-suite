import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';
import type { BuildEngine } from '../../src/ports/pobEngine.js';

it('lets the enemy level follow a boss preset change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pob-config-coupling-'));
  try {
    const store = new SnapshotStore(dir);
    const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
    let current: Record<string, unknown> = { enemyIsBoss: 'None', enemyLevel: 84, useFrenzyCharges: true };
    const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {}, close: async () => {}, verifyIdentity: async () => {},
      getConfig: async () => ({ ...current }), getStats: async () => ({ Life: 100 }), getBuildInfo: async () => ({}), getSkills: async () => ({}),
      setConfig: async (changes: Record<string, unknown>) => { current = { ...current, ...changes, enemyLevel: 85 }; return { applied: { ...changes }, rejected: {} }; } } as unknown as BuildEngine;
    const foundation = new BuildFoundation(store, async () => engine);
    const result = await foundation.evaluate(parent.id, ['Life'], { config: { enemyIsBoss: 'Pinnacle' } });
    expect(result.context.config).toMatchObject({ enemyIsBoss: 'Pinnacle', enemyLevel: 85 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('does not publish a derived snapshot when setting a config also changes an unrelated option', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pob-config-isolation-'));
  try {
    const store = new SnapshotStore(dir);
    const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
    let current = { enemyIsBoss: 'None', useFrenzyCharges: true };
    const captureSnapshot = jest.fn();
    const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {}, close: async () => {},
      getConfig: async () => ({ ...current }), captureSnapshot,
      getStats: async () => ({ Life: 100 }), getBuildInfo: async () => ({}), getSkills: async () => ({}),
      setConfig: async () => { current = { enemyIsBoss: 'Pinnacle', useFrenzyCharges: false }; return { applied: { enemyIsBoss: 'Pinnacle' }, rejected: {} }; } } as unknown as BuildEngine;
    const foundation = new BuildFoundation(store, async () => engine);
    await expect(foundation.deriveConfig(parent.id, { enemyIsBoss: 'Pinnacle' })).rejects.toThrow('unrelated configuration');
    current = { enemyIsBoss: 'None', useFrenzyCharges: true };
    await expect(foundation.evaluate(parent.id, ['Life'], { config: { enemyIsBoss: 'Pinnacle' } })).rejects.toThrow('unrelated configuration');
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    expect((await store.read(parent.id)).xml).toBe('<original/>');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
