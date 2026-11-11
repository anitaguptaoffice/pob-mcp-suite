import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BuildFoundation, type BuildEngine } from '../../src/foundation/buildFoundation.js';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';

function addSingleCatalog(engine: BuildEngine) {
  Object.assign(engine, {
    listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] }),
    selectSpec: async () => {},
    listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: 'Default', active: true, useSecondWeaponSet: false }] }),
    selectItemSet: async () => {},
  });
  if (!engine.getTree) engine.getTree = async () => ({ nodes: [1] });
}

describe('BuildFoundation isolation', () => {
  it('refuses a tree removal if PoB removes more than its declared dependencies', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-removal-mismatch-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let nodes = [1, 2, 3];
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: nodes.length }] }), selectSpec: async () => {},
        getTree: async () => ({ nodes: [...nodes], treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {} }), getItems: async () => [],
        queryTreePaths: async () => ({ mode: 'allocated', treeVersion: '3_29', nodes: nodes.map(id => ({ id, name: `Node ${id}`, nameKnown: true })) }),
        deallocateTreeNode: async () => { nodes = [1]; return { tree: {}, expectedRemoved: [2] }; }, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).trialTreeRemoval(parent.id, 2)).rejects.toThrow('declared dependencies');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect((await store.read(parent.id)).xml).toBe('<build/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish a partially allocated tree when a later automatic path fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-path-atomic-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let nodes = [1];
      const tree = () => ({ nodes: [...nodes], treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {} });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] }), selectSpec: async () => {},
        getTree: async () => tree(), getItems: async () => [],
        queryTreePaths: async ({ targetNodeId }: { targetNodeId: number }) => targetNodeId === 2
          ? { treeVersion: '3_29', mode: 'target', targetNodeId, status: 'found', node: { id: 2, type: 'normal', status: 'reachable', allocated: false, isBlighted: false, pathNodes: [2], pointCost: 1 } }
          : { treeVersion: '3_29', mode: 'target', targetNodeId, status: 'not_found' },
        updateTreeDelta: async () => { nodes = [1, 2]; return { tree: tree(), droppedNodes: [] }; }, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveTreePaths(parent.id, [2, 3])).rejects.toThrow('did not find target node 3');
      expect(nodes).toEqual([1, 2]);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect((await store.read(parent.id)).xml).toBe('<build/>');
      await expect(foundation.deriveTreePaths(parent.id, [2, 2])).rejects.toThrow('Invalid tree path');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects automatic paths that alter an inactive passive spec', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-path-inactive-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let currentSpec = 1, added = false;
      const tree = () => ({ nodes: currentSpec === 1 && added ? [1, 2] : currentSpec === 2 && added ? [4] : [1], treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {} });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => ({ activeSpec: currentSpec, specs: [1, 2].map(index => ({ index, title: `Spec ${index}`, active: index === currentSpec, nodeCount: index === 1 && added ? 2 : 1 })) }),
        selectSpec: async (index: number) => { currentSpec = index; }, getTree: async () => tree(), getItems: async () => [],
        queryTreePaths: async () => ({ treeVersion: '3_29', mode: 'target', targetNodeId: 2, status: 'found', node: { id: 2, type: 'normal', status: 'reachable', allocated: false, isBlighted: false, pathNodes: [2], pointCost: 1 } }),
        updateTreeDelta: async () => { added = true; return { tree: tree(), droppedNodes: [] }; }, refreshTreeProgress: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveTreePaths(parent.id, [2])).rejects.toThrow('inactive passive spec');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects auto-equipping when PoB selects no slot or replaces occupied equipment', async () => {
    for (const selectedSlot of [undefined, 'Ring 1']) {
      const dir = await mkdtemp(path.join(tmpdir(), 'pob-auto-item-reject-'));
      try {
        const store = new SnapshotStore(dir);
        const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
        let added = false;
        const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
          getItemInventory: async () => [{ id: 1, raw: 'original' }], getTree: async () => ({ nodes: [1] }), getSkills: async () => ({}), getConfig: async () => ({}),
          listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] }), selectSpec: async () => {},
          listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: 'Default', active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => {},
          getItems: async () => [{ slot: 'Ring 1', id: added && selectedSlot ? 2 : 1 }],
          addItem: async () => { added = true; return { id: 2, slot: selectedSlot }; }, close: async () => {},
        } as unknown as BuildEngine;
        await expect(new BuildFoundation(store, async () => engine).deriveAutoItem(parent.id, 'item')).rejects.toThrow(selectedSlot ? 'beyond the selected empty slot' : 'did not auto-equip');
        expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  });
  it('rejects auto-equipping that changes an inactive equipment set or passive spec', async () => {
    for (const failure of ['set', 'spec', 'spec_slot'] as const) {
      const dir = await mkdtemp(path.join(tmpdir(), 'pob-auto-other-set-'));
      try {
        const store = new SnapshotStore(dir);
        const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
        let added = false, currentSet = 1, currentSpec = 1;
        const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
          getItemInventory: async () => added ? [{ id: 2, raw: 'new' }] : [],
          listSpecs: async () => ({ activeSpec: currentSpec, specs: [1, 2].map(index => ({ index, title: `Spec ${index}`, active: index === currentSpec, nodeCount: 1 })) }), selectSpec: async (index: number) => { currentSpec = index; },
          listItemSets: async () => ({ activeItemSetId: currentSet, itemSets: [1, 2].map(id => ({ id, title: `Set ${id}`, active: id === currentSet, useSecondWeaponSet: false })) }), selectItemSet: async (id: number) => { currentSet = id; },
          getTree: async () => ({ nodes: currentSpec === 2 && failure === 'spec' && added ? [2] : [1] }),
          getItems: async () => [{ slot: 'Ring 1', id: added && currentSpec === 2 && failure === 'spec_slot' ? 99 : added && (currentSet === 1 || failure === 'set') ? 2 : 0 }],
          getSkills: async () => ({}), getConfig: async () => ({}), addItem: async () => { added = true; return { id: 2, slot: 'Ring 1' }; }, close: async () => {},
        } as unknown as BuildEngine;
        await expect(new BuildFoundation(store, async () => engine).deriveAutoItem(parent.id, 'item')).rejects.toThrow(failure === 'set' ? 'inactive equipment set' : failure === 'spec_slot' ? 'selected slot unexpectedly' : 'passive spec');
        expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  });
  it('never publishes an inventory item that equips itself, alters an inactive set or spec, or disappears on reload', async () => {
    for (const failure of ['equipped', 'inactive', 'spec', 'lost'] as const) {
      const dir = await mkdtemp(path.join(tmpdir(), 'pob-inventory-reject-'));
      try {
        const store = new SnapshotStore(dir);
        const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
        let loads = 0, items = [{ id: 1, raw: 'existing' }], currentSet = 1, currentSpec = 1;
        const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
          loadBuildXml: async () => { loads++; if (loads > 1 && failure === 'lost') items = [{ id: 1, raw: 'existing' }]; },
          getItemInventory: async () => [...items],
          addItem: async (_text: string, _slot: undefined, noAutoEquip: boolean) => { expect(noAutoEquip).toBe(true); items = [...items, { id: 2, raw: 'new' }]; return { id: 2, ...(failure === 'equipped' ? { slot: 'Ring 1' } : {}) }; },
          listSpecs: async () => ({ activeSpec: currentSpec, specs: [1, 2].map(index => ({ index, title: `Spec ${index}`, active: index === currentSpec, nodeCount: 1 })) }), selectSpec: async (index: number) => { currentSpec = index; },
          listItemSets: async () => ({ activeItemSetId: currentSet, itemSets: [1, 2].map(id => ({ id, title: `Set ${id}`, active: id === currentSet, useSecondWeaponSet: false })) }),
          selectItemSet: async (id: number) => { currentSet = id; },
          getBuildInfo: async () => ({}), getTree: async () => ({ nodes: currentSpec === 2 && failure === 'spec' && items.length === 2 ? [2] : [1] }), getItems: async () => currentSet === 2 && failure === 'inactive' && items.length === 2 ? [{ slot: 'Ring 1', id: 2 }] : [], getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}),
          captureSnapshot: async () => ({ xml: '<changed/>' }), verifyIdentity: async () => {}, close: async () => {},
        } as unknown as BuildEngine;
        const foundation = new BuildFoundation(store, async () => engine);
        await expect(foundation.deriveInventoryItem(parent.id, 'item')).rejects.toThrow(failure === 'equipped' ? 'unequipped' : failure === 'inactive' ? 'equipment set' : failure === 'spec' ? 'passive spec' : 'survive serialization');
        expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  });
  it('refuses to publish when preserving node overrides changes their content', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-tree-overrides-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let changed = false;
      const catalog = { activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] };
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => catalog, selectSpec: async () => catalog, getTree: async () => ({ treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [1], masteryEffects: {} }),
        getItems: async () => [], getSkills: async () => ({}), getConfig: async () => ({}), getTreeOverrides: async () => [{ nodeId: 1, name: changed ? 'different' : 'original' }], setTree: async () => { changed = true; }, close: async () => {} } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveTreeReplacement(parent.id, { classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [1], masteryEffects: {} }, false, 'preserve')).rejects.toThrow('changed node overrides');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses a full tree replacement when PoB drops a requested node', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-tree-replace-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const catalog = { activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] };
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => catalog, selectSpec: async () => catalog, getTree: async () => ({ treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [1], masteryEffects: {} }),
        getItems: async () => [], getSkills: async () => ({}), getConfig: async () => ({}), setTree: async () => ({}), close: async () => {} } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveTreeReplacement(parent.id, { classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [1, 2], masteryEffects: {} })).rejects.toThrow('complete requested tree');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses a tree changed by automatic progress refresh', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-tree-refresh-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let nodes = [1];
      const catalog = { activeSpec: 1, specs: [{ index: 1, title: 'Default', active: true, nodeCount: 1 }] };
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => catalog, selectSpec: async () => catalog, getTree: async () => ({ treeVersion: '3_29', classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, nodes, masteryEffects: {} }),
        getItems: async () => [], getSkills: async () => ({}), getConfig: async () => ({}), setTree: async () => { nodes = [1, 2]; }, refreshTreeProgress: async () => { nodes = [1]; }, close: async () => {} } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveTreeReplacement(parent.id, { classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [1, 2], masteryEffects: {} })).rejects.toThrow('refreshing progress');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish a batch if a later item fails and rejects duplicate slots', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-items-batch-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let equipped = false;
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getItems: async () => [{ slot: 'Ring 1', id: equipped ? 1 : 0 }, { slot: 'Helmet', id: 0 }],
        addItem: async (_text: string, slot: string) => { if (slot === 'Helmet') throw new Error('incompatible'); equipped = true; return { id: 1, slot }; }, close: async () => {},
      } as unknown as BuildEngine;
      addSingleCatalog(engine);
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveItems(parent.id, [{ slot: 'Ring 1', itemText: 'item' }, { slot: 'Helmet', itemText: 'item' }])).rejects.toThrow('incompatible');
      await expect(foundation.deriveItems(parent.id, [{ slot: 'Ring 1', itemText: 'item' }, { slot: 'Ring 1', itemText: 'item' }])).rejects.toThrow('duplicate slots');
      expect((await store.read(parent.id)).xml).toBe('<build/>');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects explicit equips that corrupt inactive item sets or passive specs, including after reload', async () => {
    for (const failure of ['inactive', 'spec', 'slot', 'reload'] as const) {
      const dir = await mkdtemp(path.join(tmpdir(), 'pob-equip-inactive-'));
      try {
        const store = new SnapshotStore(dir);
        const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
        let currentSpec = 1, currentSet = 1, added = false, loads = 0;
        const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
          loadBuildXml: async () => { loads++; },
          listSpecs: async () => ({ activeSpec: currentSpec, specs: [1, 2].map(index => ({ index, title: `Spec ${index}`, active: index === currentSpec, nodeCount: 1 })) }), selectSpec: async (index: number) => { currentSpec = index; },
          listItemSets: async () => ({ activeItemSetId: currentSet, itemSets: [1, 2].map(id => ({ id, title: `Set ${id}`, active: id === currentSet, useSecondWeaponSet: false })) }), selectItemSet: async (id: number) => { currentSet = id; },
          getTree: async () => ({ nodes: [currentSpec === 2 && added && failure === 'spec' ? 2 : 1] }),
          getItems: async () => [{ slot: 'Ring 1', id: currentSet === 2 ? ((added && failure === 'inactive') || (loads > 1 && failure === 'reload') ? 8 : 7) : added ? (currentSpec === 2 && failure === 'slot' ? 99 : 3) : 1 }],
          addItem: async () => { added = true; return { id: 3, slot: 'Ring 1' }; },
          getBuildInfo: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getStats: async () => ({}),
          captureSnapshot: async () => ({ xml: '<changed/>' }), verifyIdentity: async () => {}, close: async () => {},
        } as unknown as BuildEngine;
        const foundation = new BuildFoundation(store, async () => engine);
        await expect(foundation.deriveItem(parent.id, 'Ring 1', 'item')).rejects.toThrow(failure === 'inactive' ? 'inactive equipment set' : failure === 'spec' ? 'passive spec' : failure === 'slot' ? 'requested slot unexpectedly' : 'survive serialization');
        expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
        expect((await store.read(parent.id)).xml).toBe('<build/>');
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  });
  it('does not publish a newly created build when PoB changes its tree on reload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-new-build-'));
    try {
      const store = new SnapshotStore(dir);
      let reloaded = false;
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        newBuild: async () => {}, captureSnapshot: async () => ({ xml: '<build/>' }),
        getTree: async () => ({ className: 'Witch', ascendClassName: reloaded ? 'Occultist' : 'Necromancer' }),
        loadBuildXml: async () => { reloaded = true; }, verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.createBuild('Witch', 'Occultist')).rejects.toThrow('did not confirm');
      await expect(foundation.createBuild('Witch', undefined, '../bad')).rejects.toThrow('tree version');
      await expect(foundation.createBuild('Witch', 'Necromancer')).rejects.toThrow('did not preserve');
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish a full gem setup if adding a later gem fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-gem-setup-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const removeGem = jest.fn(async () => {}), addGem = jest.fn(async () => { throw new Error('unknown gem'); });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}), getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [{ index: 1, name: 'Arc', isSupport: false, enabled: true }, { index: 2, name: 'Support', isSupport: true, enabled: true }] }] }), removeGem, addGem, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveGemSetup(parent.id, 1, [{ gemName: 'Arc' }, { gemName: 'Unknown Support' }], true)).rejects.toThrow('unknown gem');
      expect(removeGem).toHaveBeenCalledTimes(1); expect(addGem).toHaveBeenCalledTimes(1);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('publishes no snapshot when replacement fails after removing a support', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-support-replace-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const removeGem = jest.fn(async () => {}), addGem = jest.fn(async () => { throw new Error('unknown gem'); });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}), getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [{ index: 1, name: 'Arc', isSupport: false }, { index: 2, name: 'Support', isSupport: true, enabled: true }] }] }),
        removeGem, addGem, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveSupportReplacement(parent.id, 1, 2, { gemName: 'Invalid Support' }, true)).rejects.toThrow('unknown gem');
      expect(removeGem).toHaveBeenCalledTimes(1); expect(addGem).toHaveBeenCalledTimes(1);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a notes change that is lost on reload without publishing a snapshot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-notes-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let notes = '';
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => { notes = ''; },
        getBuildNotes: async () => notes, setBuildNotes: async (value: string) => { notes = value; }, captureSnapshot: async () => ({ xml: '<build/>' }),
        getBuildInfo: async () => ({}), getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}),
        getConfig: async () => ({}), getStats: async () => ({}), verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveNotes(parent.id, 'new notes')).rejects.toThrow('did not preserve');
      await expect(foundation.deriveNotes(parent.id, 'invalid\u0000notes')).rejects.toThrow('valid XML text');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects appended notes exceeding the combined limit before changing the engine', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-notes-limit-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const setBuildNotes = jest.fn();
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getBuildNotes: async () => 'x'.repeat(512 * 1024 - 2), setBuildNotes,
        getBuildInfo: async () => ({}), getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}),
        getConfig: async () => ({}), getStats: async () => ({}), close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveNotes(parent.id, 'x', false, 'append')).rejects.toThrow('Combined notes');
      expect(setBuildNotes).not.toHaveBeenCalled();
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a read-only operation that changes the observed build', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-read-only-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let level = 1;
      const close = jest.fn();
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getBuildInfo: async () => ({ level }), getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}),
        getConfig: async () => ({}), getStats: async () => ({}), verifyIdentity: async () => {}, close,
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.runReadOnlySnapshot(parent.id, async () => { level = 2; return 'result'; })).rejects.toThrow('read operation changed');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect(close).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects an item preview that mutates the observed build', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-preview-mutation-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let life = 100;
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getSkills: async () => ({}), getConfig: async () => ({}), getBuildInfo: async () => ({}), getStats: async () => ({ Life: life }),
        compareItem: async () => { life = 200; return { baseline: { Life: 100 }, candidateStats: { Life: 200 } }; }, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).previewItem(parent.id, 'Ring 1', 'fixture')).rejects.toThrow('preview changed');
      expect((await store.read(parent.id)).xml).toBe('<build/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('requires a replacement for the active spec and rejects an unapplied deletion', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-spec-delete-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let active = 1;
      const list = () => ({ activeSpec: active, specs: [1, 2].map(index => ({ index, title: String(index), active: index === active, nodeCount: 1 })) });
      const deleteSpec = jest.fn();
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => { active = 1; },
        listSpecs: async () => list(), selectSpec: async (index: number) => { active = index; return list(); }, getTree: async () => ({ nodes: [active] }), getItems: async () => [],
        deleteSpec, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveDeleteSpec(parent.id, 1)).rejects.toThrow('replacement_spec');
      expect(deleteSpec).not.toHaveBeenCalled();
      await expect(foundation.deriveDeleteSpec(parent.id, 2)).rejects.toThrow('did not confirm');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects unapplied spec creation and rename without publishing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-spec-edit-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const list = () => ({ activeSpec: 1, specs: [{ index: 1, title: 'Original', active: true, nodeCount: 1 }] });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        listSpecs: async () => list(), selectSpec: async () => list(), getTree: async () => ({ nodes: [1] }), getItems: async () => [],
        createSpec: async () => list(), renameSpec: async () => list(), close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveCreateSpec(parent.id, { title: 'New' })).rejects.toThrow('did not confirm');
      await expect(foundation.deriveRenameSpec(parent.id, 1, 'New')).rejects.toThrow('did not confirm');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a spec switch if an inactive passive tree changes on reload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-specs-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let active = 1, loads = 0;
      const list = () => ({ activeSpec: active, specs: [1, 2].map(index => ({ index, title: String(index), active: index === active, nodeCount: 1 })) });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        loadBuildXml: async () => { loads++; active = loads === 1 ? 1 : 2; },
        listSpecs: async () => list(), selectSpec: async (index: number) => { active = index; return list(); },
        getTree: async () => ({ nodes: [active === 1 ? (loads > 1 ? 99 : 1) : 2] }), getItems: async () => [],
        getSkills: async () => ({}), getConfig: async () => ({}), getBuildInfo: async () => ({}), getStats: async () => ({}),
        captureSnapshot: async () => ({ xml: '<changed/>' }), verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveSpec(parent.id, 2)).rejects.toThrow('Passive specs did not survive serialization');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects an item-set switch if inactive equipment changes on reload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-item-sets-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let active = 1, loads = 0;
      const list = () => ({ activeItemSetId: active, itemSets: [1, 2].map(id => ({ id, title: String(id), active: id === active, useSecondWeaponSet: false })) });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null },
        loadBuildXml: async () => { loads++; active = loads === 1 ? 1 : 2; },
        listItemSets: async () => list(), selectItemSet: async (id: number) => { active = id; return list(); },
        getItems: async () => [{ slot: 'Ring 1', id: active === 1 ? (loads > 1 ? 99 : 1) : 2 }],
        getTree: async () => ({}), getSkills: async () => ({}), getConfig: async () => ({}), getBuildInfo: async () => ({}), getStats: async () => ({}),
        captureSnapshot: async () => ({ xml: '<changed/>' }), verifyIdentity: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      await expect(new BuildFoundation(store, async () => engine).deriveItemSet(parent.id, 2)).rejects.toThrow('equipment did not survive serialization');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish when the flask state was not applied', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-flask-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getConfig: async () => ({}), getItems: async () => [{ slot: 'Flask 2', id: 2, active: true }],
        setFlaskActive: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveFlaskActive(parent.id, 2, false)).rejects.toThrow('did not confirm');
      await expect(foundation.deriveFlaskActive(parent.id, 6, true)).rejects.toThrow('Invalid flask state');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('requires an explicit replacement when removing a main group and rejects an unapplied removal', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-group-remove-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const removeSkill = jest.fn();
      let calcsSkillNumber = 1;
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}),
        getSkills: async () => ({ mainSocketGroup: 1, calcsSkillNumber, groups: [{ index: 1, gems: [] }, { index: 2, gems: [] }] }),
        removeSkill, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveRemoveSkillGroup(parent.id, 1)).rejects.toThrow('replacement_main_group');
      expect(removeSkill).not.toHaveBeenCalled();
      calcsSkillNumber = 2;
      await expect(foundation.deriveRemoveSkillGroup(parent.id, 2)).rejects.toThrow('replacement_calcs_group');
      expect(removeSkill).not.toHaveBeenCalled();
      calcsSkillNumber = 1;
      await expect(foundation.deriveRemoveSkillGroup(parent.id, 2)).rejects.toThrow('modified remaining groups');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not publish an unconfirmed skill group toggle', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-group-toggle-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}),
        getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, gems: [] }] }),
        setSocketGroupEnabled: async () => ({ groupIndex: 1, enabled: false }), close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveSkillGroupEnabled(parent.id, 1, false)).rejects.toThrow('did not confirm the skill group state');
      await expect(foundation.deriveSkillGroupEnabled(parent.id, 2, false)).rejects.toThrow('Skill group not found');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('publishes no skill group when a later gem fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-group-atomic-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const addGem = jest.fn().mockResolvedValueOnce({ gemIndex: 1, name: 'Arc' }).mockRejectedValueOnce(new Error('unknown gem'));
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}),
        getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, gems: [] }] }),
        createSocketGroup: async () => ({ index: 2 }), addGem, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveSkillGroup(parent.id, {}, [{ gemName: 'Arc' }, { gemName: 'missing' }])).rejects.toThrow('unknown gem');
      expect(addGem).toHaveBeenCalledTimes(2);
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect((await store.read(parent.id)).xml).toBe('<build/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects unconfirmed gem additions and removals without publishing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-gem-list-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => {},
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}),
        getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, gems: [{ index: 1, name: 'Arc' }] }] }),
        addGem: async () => ({ gemIndex: 2, name: 'Fireball' }), removeGem: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveGemList(parent.id, 1, { type: 'add', gemName: 'Fireball' })).rejects.toThrow('requested gem properties');
      await expect(foundation.deriveGemList(parent.id, 1, { type: 'remove', gemIndex: 1 })).rejects.toThrow('unrelated skill or gem data');
      await expect(foundation.deriveGemList(parent.id, 1, { type: 'add', gemName: 'Fireball', insertIndex: 3 })).rejects.toThrow('insertion position');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects unapplied and partial gem edits without publishing a snapshot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-gem-failure-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<build/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let level = 20;
      let failQuality = false;
      let corruptGem = false;
      const engine = {
        identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, loadBuildXml: async () => { level = 20; },
        getTree: async () => ({}), getItems: async () => [], getConfig: async () => ({}),
        getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, gems: [{ index: 1, name: corruptGem && level !== 20 ? 'Changed' : 'Arc', level, quality: 0, enabled: true }] }] }),
        setGemLevel: async ({ level: value }: { level: number }) => { level = value; },
        setGemQuality: async () => { if (failQuality) throw new Error('quality failed'); },
        setGemEnabled: async () => {}, close: async () => {},
      } as unknown as BuildEngine;
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveGem(parent.id, 1, 1, { quality: 10 })).rejects.toThrow('did not confirm');
      failQuality = true;
      await expect(foundation.deriveGem(parent.id, 1, 1, { level: 10, quality: 10 })).rejects.toThrow('quality failed');
      corruptGem = true;
      await expect(foundation.deriveGem(parent.id, 1, 1, { level: 10 })).rejects.toThrow('unrelated skill or gem data');
      await expect(foundation.deriveGem(parent.id, 1, 1, { level: 0 })).rejects.toThrow('Invalid gem change');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
      expect((await store.read(parent.id)).xml).toBe('<build/>');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
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
      addSingleCatalog(engine);
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveItem(parent.id, 'Ring 1', 'item')).rejects.toThrow('requested slot');
      wrongSlot = false;
      await expect(foundation.deriveItem(parent.id, 'Ring 1', 'item')).rejects.toThrow('changed other slots');
      expect(await readdir(dir)).toEqual([`${parent.id}.json`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects inactive jewel sockets and unintended tree changes without publishing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pob-foundation-jewel-'));
    try {
      const store = new SnapshotStore(dir);
      const parent = await store.create({ xml: '<original/>', source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
      let allocated = false, changed = false, items = [{ slot: 'Jewel 10', id: 1 }];
      const addItem = jest.fn(async () => { changed = true; items = [{ slot: 'Jewel 10', id: 2 }]; return { id: 2, slot: 'Jewel 10' }; });
      const engine = { identity: { engineVersion: null, dataVersion: null, adapterVersion: null }, verifyIdentity: async () => {}, loadBuildXml: async () => {},
        getTree: async () => ({ nodes: allocated ? changed ? [10, 11] : [10] : [] }), getItems: async () => items, addItem, close: async () => {} } as unknown as BuildEngine;
      addSingleCatalog(engine);
      const foundation = new BuildFoundation(store, async () => engine);
      await expect(foundation.deriveItem(parent.id, 'Jewel 10', 'item')).rejects.toThrow('not allocated');
      expect(addItem).not.toHaveBeenCalled(); allocated = true;
      await expect(foundation.deriveItem(parent.id, 'Jewel 10', 'item')).rejects.toThrow('changed the passive tree');
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
      const engine: BuildEngine = { setTree: async () => { throw new Error('not used'); }, inspectItemParse: async () => { throw new Error('not used'); }, getClusterJewels: async () => { throw new Error('not used'); }, getCapabilities: async () => { throw new Error('not used'); }, newBuild: async () => { throw new Error('not used'); }, getAilments: async () => { throw new Error('not used'); }, getEnemyLevelSetting: async () => ({ mode: 'automatic' }), evaluateAnointCandidates: async () => { throw new Error('not used'); }, queryTreePaths: async () => ({}), getBuildNotes: async () => '', setBuildNotes: async () => {},
        setGemLevel: async () => {}, setGemQuality: async () => {}, setGemEnabled: async () => {}, addGem: async () => ({ gemIndex: 1, name: "fixture" }), removeGem: async () => {}, createSocketGroup: async () => ({ index: 1 }), setSocketGroupEnabled: async ({ groupIndex, enabled }) => ({ groupIndex, enabled }), removeSkill: async () => {}, setCalcsSelection: async () => {}, setFlaskActive: async () => {}, listItemSets: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), selectItemSet: async () => ({ activeItemSetId: 1, itemSets: [{ id: 1, title: "fixture", active: true, useSecondWeaponSet: false }] }), listSpecs: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), selectSpec: async () => ({ activeSpec: 1, specs: [{ index: 1, title: "fixture", active: true, nodeCount: 0 }] }), createSpec: async () => ({}), renameSpec: async () => ({}), deleteSpec: async () => ({}), compareItem: async (slot: string) => ({ slot, candidate: {}, baseline: {}, candidateStats: {} }), findTimelessJewelSeedsDetailed: async () => ({ socketNodeId: 1, treeVersion: "fixture", jewelType: "Elegant Hubris", scannedSeeds: 0, totalMatches: 0, results: [] }),
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
