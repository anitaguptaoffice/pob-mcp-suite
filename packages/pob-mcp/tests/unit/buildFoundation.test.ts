import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BuildFoundation, type BuildEngine } from '../../src/foundation/buildFoundation.js';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';

describe('BuildFoundation isolation', () => {
  it('does not publish a skill selection when PoB fails to apply it or changes another group', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-skill-selection-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let skills = { mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 1 }, { index: 2, mainActiveSkill: 1 }] };
      let corruptOther = false;
      let corruptSelected = false;
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => { skills = { mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 1 }, { index: 2, mainActiveSkill: 1 }] }; },
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}), getSkills: async () => structuredClone(skills),
        setMainSelection: async () => { if (corruptOther) skills = { mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 2 }, { index: 2, mainActiveSkill: 2 }] }; if (corruptSelected) skills = { mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 2, label: 'unexpected' } as any, { index: 2, mainActiveSkill: 1 }] }; }, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveSelection(parent.id, {})).rejects.toThrow('empty');
      await expect(foundation.deriveSelection(parent.id, { mainActiveSkill: 2 })).rejects.toThrow('did not confirm');
      corruptOther = true;
      await expect(foundation.deriveSelection(parent.id, { mainActiveSkill: 2 })).rejects.toThrow('unrelated skill groups');
      corruptOther = false; corruptSelected = true;
      await expect(foundation.deriveSelection(parent.id, { mainActiveSkill: 2 })).rejects.toThrow('unrelated selected group data');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a derived snapshot if poison-inclusive minion damage changes after reload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-poison-fidelity-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let loads = 0;
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        loadBuildXml: async () => { loads++; }, setLevel: async () => {}, getBuildInfo: async () => ({ level: 50 }),
        getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}), getConfig: async () => ({}),
        getStats: async (fields: string[]) => Object.fromEntries(fields.map(field => [field, field === 'MinionCombinedDPS' && loads > 1 ? 200 : 100])),
        captureSnapshot: async () => ({ xml: '<changed/>' }), verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveLevel(parent.id, 50)).rejects.toThrow('state changes: stats');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects calculation context when the engine does not confirm skill part or config', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-context-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let selectedSkillPart = 1;
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        loadBuildXml: async () => {}, setMainSelection: async () => {},
        setConfig: async () => ({ rejected: {}, applied: { enemyIsBoss: 'Pinnacle' } }),
        getBuildInfo: async () => ({}), getStats: async () => ({ TotalDPS: 1 }),
        getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 2, selectedSkillPart }] }),
        getConfig: async () => ({ enemyIsBoss: 'None' }), verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      const selection = { mainSocketGroup: 1, mainActiveSkill: 2, skillPart: 2 };
      await expect(foundation.evaluate(parent.id, ['TotalDPS'], { selection })).rejects.toThrow('skill selection');
      selectedSkillPart = 2;
      await expect(foundation.evaluate(parent.id, ['TotalDPS'], { selection, config: { enemyIsBoss: 'Pinnacle' } })).rejects.toThrow('requested config');
      expect((await store.read(parent.id)).xml).toBe('<build/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects an equip that targets the wrong slot or changes another slot without publishing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-item-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let items = [{ slot: 'Ring 1', id: 1 }, { slot: 'Ring 2', id: 2 }];
      let wrongSlot = true;
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        verifyIdentity: async () => {}, loadBuildXml: async () => { items = [{ slot: 'Ring 1', id: 1 }, { slot: 'Ring 2', id: 2 }]; },
        getItems: async () => items,
        addItem: async () => {
          items = [{ slot: 'Ring 1', id: 3 }, { slot: 'Ring 2', id: 4 }];
          return { id: 3, slot: wrongSlot ? 'Ring 2' : 'Ring 1' };
        },
        close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveItem(parent.id, 'Ring 1', 'item')).rejects.toThrow('requested slot');
      wrongSlot = false;
      await expect(foundation.deriveItem(parent.id, 'Ring 1', 'item')).rejects.toThrow('changed other slots');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish a derived record when reloading changes observed state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      let loads = 0;
      let closed = false;
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        searchNodes: async () => ({ nodes: [], count: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => { loads++; }, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        captureSnapshot: async () => ({ xml: '<changed/>' }),
        getBuildInfo: async () => ({ level: 50 }), getTree: async () => ({}),
        getItems: async () => ({ state: loads > 1 ? 'different' : 'original' }),
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}),
        close: async () => { closed = true; },
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveLevel(parent.id, 50)).rejects.toThrow('did not survive serialization');
      expect(closed).toBe(true);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect((await store.read(parent.id)).xml).toBe('<original/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not publish when the engine fails to apply the requested level', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      let closed = false;
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        searchNodes: async () => ({ nodes: [], count: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }), getBuildInfo: async () => ({ level: 1 }),
        captureSnapshot: async () => ({ xml: '<changed/>' }), getTree: async () => ({}),
        getItems: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}),
        getStats: async () => ({}), close: async () => { closed = true; },
      };
      await expect(new BuildFoundation(store, async () => engine).deriveLevel(parent.id, 50))
        .rejects.toThrow('did not apply');
      expect(closed).toBe(true);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses known version mismatches and reports unknown identities', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: '1', dataVersion: null, adapterVersion: 'a', runtimeVersion: 'runtime-a', executableVersion: 'exe-a' });
      let loaded = false;
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        searchNodes: async () => ({ nodes: [], count: 0 }),
        identity: { engineVersion: '2', adapterVersion: 'a', dataVersion: null, runtimeVersion: 'runtime-a', executableVersion: 'exe-a' },
        loadBuildXml: async () => { loaded = true; }, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '' }),
        getTree: async () => ({}), getItems: async () => ({}), getSkills: async () => ({}),
        getConfig: async () => ({ enemyIsBoss: 'Pinnacle' }), getStats: async () => ({ Life: 5, Zero: 0, Invalid: false }), close: async () => {},
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.evaluate(parent.id, ['Life'])).rejects.toThrow('engineVersion mismatch');
      expect(loaded).toBe(false);
      engine.identity.engineVersion = '1';
      engine.identity.runtimeVersion = 'runtime-b';
      await expect(foundation.evaluate(parent.id, ['Life'])).rejects.toThrow('runtimeVersion mismatch');
      expect(loaded).toBe(false);
      engine.identity.runtimeVersion = 'runtime-a';
      engine.identity.executableVersion = 'exe-b';
      await expect(foundation.evaluate(parent.id, ['Life'])).rejects.toThrow('executableVersion mismatch');
      expect(loaded).toBe(false);
      engine.identity.engineVersion = null;
      engine.identity.executableVersion = 'exe-a';
      const result = await foundation.evaluate(parent.id, ['Life', 'Zero', 'Missing', 'Invalid']);
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('engineVersion is unknown'), expect.stringContaining('dataVersion is unknown')]));
      expect(result.stats).toEqual({ Life: 5, Zero: 0, Invalid: false });
      expect(result.metrics).toEqual({ Life: { status: 'available', value: 5 }, Zero: { status: 'available', value: 0 }, Missing: { status: 'unknown', value: null, reason: expect.any(String) }, Invalid: { status: 'unknown', value: null, reason: expect.any(String) } });
      expect(result.context.config).toEqual({ enemyIsBoss: 'Pinnacle' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('applies calculation options in a disposable engine and rejects partial config', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      const selection = jest.fn(async () => {});
      const config = jest.fn(async () => ({ rejected: { badOption: 'unknown' } }));
      const closed = jest.fn(async () => {});
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        searchNodes: async () => ({ nodes: [], count: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: selection, setConfig: config,
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '' }), getTree: async () => ({}),
        getItems: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: closed,
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.evaluate(parent.id, ['Life'], { selection: { mainSocketGroup: 1 }, config: { badOption: true } })).rejects.toThrow('PoB rejected config');
      expect(selection).toHaveBeenCalledWith({ mainSocketGroup: 1 });
      expect(config).toHaveBeenCalledWith({ badOption: true });
      expect(closed).toHaveBeenCalled();
      expect((await store.read(parent.id)).xml).toBe('<original/>');
      await expect(foundation.deriveConfig(parent.id, { badOption: true })).rejects.toThrow('PoB rejected config');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      await expect(foundation.deriveConfig(parent.id, {})).rejects.toThrow('empty');
      await expect(foundation.evaluate(parent.id, ['Life'], { selection: { mainSocketGroup: 0 } })).rejects.toThrow('Invalid skill selection');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('reads only requested sections and rejects invalid selections before engine startup', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      const getTree = jest.fn(async () => ({ nodes: [1] }));
      const getItems = jest.fn(async () => [{ slot: 'Helmet' }]);
      const close = jest.fn(async () => {});
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        searchNodes: async () => ({ nodes: [], count: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {},
        setConfig: async () => ({ rejected: {} }), getBuildInfo: async () => ({}),
        captureSnapshot: async () => ({ xml: '' }), getTree, getItems,
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close,
      };
      const open = jest.fn(async () => engine);
      const foundation = new BuildFoundation(store, open);
      await expect(foundation.inspect(parent.id, ['tree', 'tree'])).rejects.toThrow('sections');
      await expect(foundation.inspect(parent.id, ['invalid'])).rejects.toThrow('sections');
      expect(open).not.toHaveBeenCalled();
      const result = await foundation.inspect(parent.id, ['tree']);
      expect(result.data).toEqual({ tree: { nodes: [1] } });
      expect(getItems).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('searches the snapshot tree with explicit defaults and reports bounded results', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      const searchNodes = jest.fn(async () => ({ nodes: [{ id: 1, name: 'Life' }], count: 1 }));
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '' }), getTree: async () => ({ treeVersion: '3_28' }),
        searchNodes, getItems: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const open = jest.fn(async () => engine);
      const foundation = new BuildFoundation(store, open);
      await expect(foundation.searchTree(parent.id, 'life', { limit: 0 })).rejects.toThrow('options');
      expect(open).not.toHaveBeenCalled();
      const result = await foundation.searchTree(parent.id, ' life ', { limit: 1 });
      expect(searchNodes).toHaveBeenCalledWith({ keyword: 'life', nodeType: undefined, maxResults: 1, includeAllocated: false });
      expect(result).toMatchObject({ treeVersion: '3_28', returnedCount: 1, possiblyTruncated: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('reports failed PoB support checks without treating candidates as a damage ranking', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null,
        engineVersion: null, dataVersion: null, adapterVersion: null });
      const search = jest.fn(async () => ({ groupIndex: 1, skillName: 'Vortex', candidates: [{ id: 'x', name: 'Efficacy', exceptional: false, alreadySocketed: false }], total: 1, failed: 2 }));
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        getItemAffixWeight: async (modId: string) => ({ modId, base: 'test', weight: 0 }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '' }), getTree: async () => ({}),
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: search,
        getItems: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const open = jest.fn(async () => engine);
      const foundation = new BuildFoundation(store, open);
      await expect(foundation.compatibleSupports(parent.id, { groupIndex: 0 })).rejects.toThrow('options');
      expect(open).not.toHaveBeenCalled();
      const result = await foundation.compatibleSupports(parent.id, { query: ' Efficacy ' });
      expect(search).toHaveBeenCalledWith({ groupIndex: undefined, query: 'Efficacy', limit: 25, includeExceptional: true });
      expect(result.failed).toBe(2);
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('incomplete'), expect.stringContaining('damage gain')]));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('validates item data before opening PoB and preserves unknown eligibility', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const weight = jest.fn(async (modId: string) => ({ modId, base: 'Ring', weight: 0 }));
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        verifyIdentity: async () => {},
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '' }), getTree: async () => ({}),
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        getItemAffixWeight: weight, getItems: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const open = jest.fn(async () => engine);
      const foundation = new BuildFoundation(store, open);
      await expect(foundation.itemAffixWeight(parent.id, '', 'item')).rejects.toThrow('modifier');
      expect(open).not.toHaveBeenCalled();
      const result = await foundation.itemAffixWeight(parent.id, 'mod', 'item');
      expect(result).toMatchObject({ weight: 0, itemLevelAllows: null });
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('not a crafting probability')]));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not return data or publish a snapshot when engine identity changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const close = jest.fn(async () => {});
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        updateTreeDelta: async () => ({ tree: {} }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null },
        verifyIdentity: async () => { throw new Error('changed during operation'); },
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({ level: 50 }), captureSnapshot: async () => ({ xml: '<changed/>' }), getTree: async () => ({}),
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        getItemAffixWeight: async modId => ({ modId, base: 'Ring', weight: 0 }), getItems: async () => ({}),
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({ Life: 10 }), close,
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.evaluate(parent.id, ['Life'])).rejects.toThrow('changed during operation');
      await expect(foundation.deriveLevel(parent.id, 50)).rejects.toThrow('changed during operation');
      await expect(foundation.importBuild('<new/>', 'test')).rejects.toThrow('changed during operation');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect(close).toHaveBeenCalledTimes(3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects unexpected passive-node loss without publishing a tree snapshot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const base = { nodes: [1, 2], treeVersion: '3_28', classId: 1, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {} };
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null }, verifyIdentity: async () => {},
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '<changed/>' }), getTree: async () => base,
        updateTreeDelta: async () => ({ tree: { ...base, nodes: [1] }, droppedNodes: [3] }),
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        getItemAffixWeight: async modId => ({ modId, base: 'Ring', weight: 0 }), getItems: async () => ({}),
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveTree(parent.id, [3], [])).rejects.toThrow('exactly the requested');
      await expect(foundation.deriveTree(parent.id, [3], [3])).rejects.toThrow('Invalid tree node changes');
      await expect(foundation.deriveTree(parent.id, [3], [], { '4': 5 })).rejects.toThrow('Invalid new mastery effects');
      await expect(foundation.deriveTree(parent.id, [3], [], { '3': 5 })).rejects.toThrow('Invalid new mastery effect');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('accepts an empty mastery table representation but rejects nonempty mastery changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const base = { nodes: [1], treeVersion: '3_28', classId: 1, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: [] as number[] };
      let tree = base;
      let unexpected = false;
      const refresh = jest.fn(async () => {});
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: refresh,
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        getMasteryOptions: async () => ({ masteries: [] }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null }, verifyIdentity: async () => {},
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '<changed/>' }), getTree: async () => tree,
        updateTreeDelta: async () => { tree = { ...base, nodes: [1, 2], masteryEffects: unexpected ? [9] : [] }; return { tree }; },
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        getItemAffixWeight: async modId => ({ modId, base: 'Ring', weight: 0 }), getItems: async () => ({}),
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const foundation = new BuildFoundation(store, async () => engine);
      expect((await foundation.deriveTree(parent.id, [2], [])).parentId).toBe(parent.id);
      expect(refresh).toHaveBeenCalledTimes(1);
      tree = base;
      unexpected = true;
      await expect(foundation.deriveTree(parent.id, [2], [])).rejects.toThrow('invalid mastery map');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('validates mastery effects against PoB options before mutation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const tree = { nodes: [1], treeVersion: '3_28', classId: 1, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: { '1': 5 } };
      const update = jest.fn(async () => ({ tree }));
      const engine: BuildEngine = {
        addItem: async () => ({ id: 1 }),
        refreshTreeProgress: async () => {},
        getMasteryNodeOptions: async nodeId => ({ nodeId, nodeName: 'Mastery', allocated: false, availableEffects: [] }),
        identity: { engineVersion: null, adapterVersion: null, dataVersion: null }, verifyIdentity: async () => {},
        loadBuildXml: async () => {}, setLevel: async () => {}, setMainSelection: async () => {}, setConfig: async () => ({ rejected: {} }),
        getBuildInfo: async () => ({}), captureSnapshot: async () => ({ xml: '<changed/>' }), getTree: async () => tree,
        updateTreeDelta: update, getMasteryOptions: async () => ({ masteries: [{ nodeId: 1, availableEffects: [{ effectId: 5 }] }] }),
        searchNodes: async () => ({ nodes: [], count: 0 }), getCompatibleSupports: async () => ({ groupIndex: 1, candidates: [], total: 0, failed: 0 }),
        getItemAffixWeight: async modId => ({ modId, base: 'Ring', weight: 0 }), getItems: async () => ({}),
        getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      };
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveMasteries(parent.id, { '1': 999 })).rejects.toThrow('Invalid or unallocated');
      expect(update).not.toHaveBeenCalled();
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
