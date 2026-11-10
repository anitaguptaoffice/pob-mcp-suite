import { isDeepStrictEqual } from 'node:util';
import { SnapshotStore, snapshotMetadata, type SnapshotRecord } from './snapshotStore.js';
import { EngineLimiter } from './engineLimiter.js';
import { normalizeObservation } from './observation.js';
import { MAX_BUILD_BYTES, decodeShareCode } from './shareCode.js';
import { toFiniteNumber } from '../pobLuaBridge.js';

/** The adapter owns a disposable PoB instance; it must never share live state. */
export interface BuildEngine {
  identity: { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null };
  verifyIdentity(): Promise<void>;
  loadBuildXml(xml: string): Promise<unknown>;
  getStats(fields?: string[]): Promise<unknown>;
  setLevel(level: number): Promise<void>;
  setMainSelection(selection: { mainSocketGroup?: number; mainActiveSkill?: number; skillPart?: number }): Promise<void>;
  setConfig(config: Record<string, string | number | boolean>): Promise<{ rejected: Record<string, string>; applied?: Record<string, unknown> }>;
  getBuildInfo(): Promise<{ level?: number }>;
  captureSnapshot(): Promise<{ xml: string }>;
  getTree(): Promise<unknown>;
  refreshTreeProgress(): Promise<void>;
  updateTreeDelta(params: { addNodes: number[]; removeNodes: number[]; masteryEffects?: Record<string, number> }): Promise<{ tree: unknown; droppedNodes?: number[] }>;
  getMasteryNodeOptions(nodeId: number): Promise<{ nodeId: number; nodeName: string; allocated: boolean; availableEffects: Array<{ effectId: number; stat: string }> }>;
  getMasteryOptions(): Promise<{ masteries: Array<{ nodeId: number | string; availableEffects: Array<{ effectId: number }> }> }>;
  searchNodes(params: { keyword: string; nodeType?: string; maxResults: number; includeAllocated: boolean }): Promise<{ nodes: unknown[]; count: number }>;
  getItems(): Promise<unknown>;
  addItem(itemText: string, slot: string): Promise<{ id: number; slot?: string }>;
  getItemAffixWeight(modId: string, itemText: string): Promise<{ modId: string; base: string; weight: number; itemLevel?: number; requiredItemLevel?: number; affixType?: string; affixGroup?: string }>;
  getSkills(): Promise<unknown>;
  getCompatibleSupports(params: { groupIndex?: number; query?: string; limit?: number; includeExceptional?: boolean }): Promise<{
    groupIndex: number; skillName?: string; candidates: Array<{ id: string; name: string; exceptional: boolean; alreadySocketed: boolean }>;
    total: number; failed: number;
  }>;
  getConfig(): Promise<unknown>;
  close(): Promise<void>;
}
export interface EvaluationOptions {
  selection?: { mainSocketGroup?: number; mainActiveSkill?: number; skillPart?: number };
  config?: Record<string, string | number | boolean>;
}

export function validateEvaluationOptions(options: EvaluationOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid evaluation options');
  for (const key of Object.keys(options)) if (!['selection', 'config'].includes(key)) throw new Error(`Invalid evaluation option: ${key}`);
  if (options.selection !== undefined) {
    if (!options.selection || typeof options.selection !== 'object' || Array.isArray(options.selection)) throw new Error('Invalid skill selection');
    for (const [key, value] of Object.entries(options.selection)) {
      if (!['mainSocketGroup', 'mainActiveSkill', 'skillPart'].includes(key) || !Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`Invalid skill selection: ${key}`);
    }
  }
  if (options.config !== undefined) {
    if (!options.config || typeof options.config !== 'object' || Array.isArray(options.config)) throw new Error('Invalid config');
    for (const [key, value] of Object.entries(options.config)) {
      if (!key || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Invalid config: ${key}`);
    }
  }
}
function checkIdentity(snapshot: SnapshotRecord, engine: BuildEngine): string[] {
  const warnings: string[] = [];
  for (const key of ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const) {
    const expected = snapshot[key];
    const actual = engine.identity[key];
    if (expected && actual && expected !== actual) throw new Error(`Snapshot ${key} mismatch`);
    if (!expected || !actual) warnings.push(`${key} is unknown; compatibility cannot be established`);
  }
  warnings.push('Fingerprints do not cover external dependencies, wrapper interpreters or transient changes between checks');
  return warnings;
}
async function observe(engine: BuildEngine) {
  return normalizeObservation({ info: await engine.getBuildInfo(), tree: await engine.getTree(),
    items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig(),
    stats: await engine.getStats(['Life', 'EnergyShield', 'TotalEHP', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS']) });
}

export class BuildFoundation {
  private readonly limiter: EngineLimiter<BuildEngine>;
  constructor(private readonly store: SnapshotStore, openEngine: () => Promise<BuildEngine>) {
    this.limiter = new EngineLimiter(openEngine);
  }

  async importBuild(xml: string, source: string): Promise<SnapshotRecord> {
    if (!xml.trim() || Buffer.byteLength(xml, 'utf8') > MAX_BUILD_BYTES) throw new Error('Build XML is empty or exceeds the size limit');
    return this.limiter.withEngine(async engine => {
      await engine.loadBuildXml(xml);
      await engine.verifyIdentity();
      return await this.store.create({ xml, source, parentId: null, ...engine.identity });
    });
  }

  async importCode(code: string): Promise<SnapshotRecord> {
    return this.importBuild(decodeShareCode(code), 'share-code');
  }

  async evaluate(id: string, fields: string[], options: EvaluationOptions = {}) {
    validateEvaluationOptions(options);
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      if (options.selection && Object.keys(options.selection).length) await engine.setMainSelection(options.selection);
      let appliedConfig: Record<string, unknown> | undefined;
      if (options.config && Object.keys(options.config).length) {
        const result = await engine.setConfig(options.config);
        if (Object.keys(result.rejected).length) throw new Error(`PoB rejected config: ${JSON.stringify(result.rejected)}`);
        appliedConfig = result.applied;
      }
      const stats = await engine.getStats(fields);
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('PoB returned invalid stats');
      const values = stats as Record<string, unknown>;
      const metrics = Object.fromEntries(fields.map(field => {
        const raw = values[field];
        const number = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? toFiniteNumber(raw) : undefined;
        return [field, number === undefined
          ? { status: 'unknown', value: null, reason: 'PoB did not return a finite numeric value' }
          : { status: 'available', value: number }];
      }));
      const context = { build: await engine.getBuildInfo(), skills: await engine.getSkills(), config: await engine.getConfig() };
      if (options.selection && Object.keys(options.selection).length) {
        const skills = context.skills as { mainSocketGroup?: number; groups?: Array<{ index?: number; mainActiveSkill?: number; selectedSkillPart?: number }> };
        const group = skills?.groups?.find(entry => entry.index === skills.mainSocketGroup);
        if (!group || (options.selection.mainSocketGroup !== undefined && skills?.mainSocketGroup !== options.selection.mainSocketGroup) ||
            (options.selection.mainActiveSkill !== undefined && group?.mainActiveSkill !== options.selection.mainActiveSkill) ||
            (options.selection.skillPart !== undefined && group?.selectedSkillPart !== options.selection.skillPart)) {
          throw new Error('PoB did not confirm the requested skill selection');
        }
      }
      if (options.config && Object.keys(options.config).length && (!appliedConfig || !context.config || typeof context.config !== 'object' || Array.isArray(context.config) ||
          Object.keys(options.config).some(key => !Object.hasOwn(appliedConfig!, key) || !isDeepStrictEqual((context.config as Record<string, unknown>)[key], appliedConfig![key])))) {
        throw new Error('PoB did not confirm the requested config');
      }
      await engine.verifyIdentity();
      return { snapshotId: id, stats, metrics, context, identity: engine.identity, warnings };
    });
  }

  async inspect(id: string, sections: string[]) {
    const allowed = ['build', 'tree', 'items', 'skills', 'config'];
    if (!Array.isArray(sections) || sections.length === 0 || sections.length > allowed.length ||
        sections.some(section => typeof section !== 'string' || !allowed.includes(section)) || new Set(sections).size !== sections.length) {
      throw new Error('Invalid inspection sections');
    }
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const data: Record<string, unknown> = {};
      for (const section of sections) {
        switch (section) {
          case 'build': data.build = await engine.getBuildInfo(); break;
          case 'tree': data.tree = await engine.getTree(); break;
          case 'items': data.items = await engine.getItems(); break;
          case 'skills': data.skills = await engine.getSkills(); break;
          case 'config': data.config = await engine.getConfig(); break;
        }
      }
      await engine.verifyIdentity();
      return { snapshotId: id, data, identity: engine.identity, warnings };
    });
  }

  async itemAffixWeight(id: string, modId: string, itemText: string) {
    if (typeof modId !== 'string' || !modId.trim() || modId.length > 200 ||
        typeof itemText !== 'string' || !itemText.trim() || Buffer.byteLength(itemText, 'utf8') > 10240) {
      throw new Error('Valid modifier ID and item text up to 10 KB are required');
    }
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const result = await engine.getItemAffixWeight(modId.trim(), itemText);
      if (!result || typeof result.weight !== 'number' || !Number.isFinite(result.weight)) throw new Error('PoB returned invalid affix weight');
      const itemLevelAllows = typeof result.itemLevel === 'number' && Number.isFinite(result.itemLevel) &&
        typeof result.requiredItemLevel === 'number' && Number.isFinite(result.requiredItemLevel)
        ? result.itemLevel >= result.requiredItemLevel : null;
      await engine.verifyIdentity();
      return { snapshotId: id, source: 'pob_item_data', ...result, itemLevelAllows, identity: engine.identity,
        warnings: [...warnings, 'PoB spawn weight is not a crafting probability or proof of item legality or availability.'] };
    });
  }

  async compatibleSupports(id: string, options: { groupIndex?: number; query?: string; limit?: number; includeExceptional?: boolean } = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !['groupIndex', 'query', 'limit', 'includeExceptional'].includes(key)) ||
        (options.groupIndex !== undefined && (!Number.isSafeInteger(options.groupIndex) || options.groupIndex < 1)) ||
        (options.query !== undefined && (typeof options.query !== 'string' || options.query.length > 80)) ||
        (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) ||
        (options.includeExceptional !== undefined && typeof options.includeExceptional !== 'boolean')) throw new Error('Invalid support query options');
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const params = { groupIndex: options.groupIndex, query: options.query?.trim(),
        limit: options.limit ?? 25, includeExceptional: options.includeExceptional ?? true };
      const result = await engine.getCompatibleSupports(params);
      if (!result || !Array.isArray(result.candidates) || !Number.isInteger(result.total) || !Number.isInteger(result.failed)) throw new Error('PoB returned invalid support candidates');
      await engine.verifyIdentity();
      return { snapshotId: id, query: params.query ?? '', includeExceptional: params.includeExceptional,
        limit: params.limit, ...result, identity: engine.identity,
        warnings: [...warnings, 'Compatibility does not establish damage gain, availability, price or socket requirements.',
          ...(result.failed ? ['Some compatibility checks failed; candidates may be incomplete.'] : [])] };
    });
  }

  async searchTree(id: string, query: string, options: { nodeType?: string; limit?: number; includeAllocated?: boolean } = {}) {
    const types = ['normal', 'notable', 'keystone', 'jewel', 'mastery', 'ascendancy'];
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Invalid tree query');
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !['nodeType', 'limit', 'includeAllocated'].includes(key)) ||
        (options.nodeType !== undefined && !types.includes(options.nodeType)) ||
        (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 30)) ||
        (options.includeAllocated !== undefined && typeof options.includeAllocated !== 'boolean')) throw new Error('Invalid tree search options');
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const tree = await engine.getTree() as { treeVersion?: unknown };
      const treeVersion = typeof tree?.treeVersion === 'string' ? tree.treeVersion : null;
      const limit = options.limit ?? 20;
      const includeAllocated = options.includeAllocated ?? false;
      const result = await engine.searchNodes({ keyword: query.trim(), nodeType: options.nodeType, maxResults: limit, includeAllocated });
      if (!result || !Array.isArray(result.nodes) || !Number.isInteger(result.count)) throw new Error('PoB returned invalid tree search results');
      await engine.verifyIdentity();
      return { snapshotId: id, treeVersion, query: query.trim(), nodeType: options.nodeType ?? null,
        includeAllocated, limit, nodes: result.nodes, returnedCount: result.nodes.length,
        possiblyTruncated: result.count >= limit, identity: engine.identity,
        warnings: [...warnings, 'PoB returns a bounded, unordered set; this is not a complete search when the limit is reached.'] };
    });
  }

  private async derive(id: string, source: string, apply: (engine: BuildEngine) => Promise<void>, trial: boolean): Promise<SnapshotRecord> {
    if (typeof trial !== 'boolean') throw new Error('Invalid trial flag');
    const parent = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      checkIdentity(parent, engine);
      await engine.loadBuildXml(parent.xml);
      await apply(engine);
      const before = await observe(engine);
      const { xml } = await engine.captureSnapshot();
      const afterCapture = await observe(engine);
      const sections = Object.keys(before) as Array<keyof typeof before>;
      const captureChanges = sections.filter(section => !isDeepStrictEqual(before[section], afterCapture[section]));
      if (captureChanges.length) throw new Error(`Snapshot capture changed build state: ${captureChanges.join(', ')}`);
      await engine.loadBuildXml(xml);
      const afterReload = await observe(engine);
      const reloadChanges = sections.filter(section => !isDeepStrictEqual(before[section], afterReload[section]));
      if (reloadChanges.length) throw new Error(`Derived build did not survive serialization without state changes: ${reloadChanges.join(', ')}`);
      await engine.verifyIdentity();
      return await this.store.create({ xml, source, parentId: id,
        engineVersion: parent.engineVersion, dataVersion: parent.dataVersion, adapterVersion: parent.adapterVersion, runtimeVersion: parent.runtimeVersion, executableVersion: parent.executableVersion }, trial);
    });
  }

  async deriveLevel(id: string, level: number, trial = false): Promise<SnapshotRecord> {
    if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error('Invalid level');
    return this.derive(id, 'derived:level', async engine => {
      await engine.setLevel(level);
      if ((await engine.getBuildInfo()).level !== level) throw new Error('PoB did not apply the requested level');
    }, trial);
  }

  async deriveItem(id: string, slot: string, itemText: string, trial = false): Promise<SnapshotRecord> {
    if (typeof slot !== 'string' || !slot.trim() || slot.length > 100 || typeof itemText !== 'string' || !itemText.trim() || Buffer.byteLength(itemText, 'utf8') > 10240) throw new Error('Invalid item or slot');
    return this.derive(id, 'derived:item', async engine => {
      const before = normalizeObservation({ items: await engine.getItems() }).items;
      if (!Array.isArray(before) || before.filter(item => item.slot === slot).length !== 1) throw new Error('Requested item slot is unavailable');
      const added = await engine.addItem(itemText, slot);
      const after = normalizeObservation({ items: await engine.getItems() }).items;
      if (!Array.isArray(after) || added.slot !== slot || !Number.isSafeInteger(added.id) || added.id < 1 || after.filter(item => item.slot === slot && item.id === added.id).length !== 1) throw new Error('PoB did not equip the item in the requested slot');
      if (!isDeepStrictEqual(before.filter(item => item.slot !== slot), after.filter(item => item.slot !== slot))) throw new Error('Equipping the item changed other slots');
    }, trial);
  }

  async deriveTree(id: string, addNodes: number[], removeNodes: number[], masteryEffects: Record<string, number> = {}, trial = false): Promise<SnapshotRecord> {
    if (!Array.isArray(addNodes) || !Array.isArray(removeNodes) || addNodes.length + removeNodes.length < 1 ||
        addNodes.length + removeNodes.length > 200 || [...addNodes, ...removeNodes].some(node => !Number.isSafeInteger(node) || node < 1) ||
        new Set([...addNodes, ...removeNodes]).size !== addNodes.length + removeNodes.length) throw new Error('Invalid tree node changes');
    if (!masteryEffects || typeof masteryEffects !== 'object' || Array.isArray(masteryEffects) ||
        Object.entries(masteryEffects).some(([node, effect]) => !/^[1-9][0-9]*$/.test(node) || !Number.isSafeInteger(Number(node)) ||
          !addNodes.includes(Number(node)) || !Number.isSafeInteger(effect) || effect < 1)) throw new Error('Invalid new mastery effects');
    return this.derive(id, 'derived:tree', async engine => {
      type Tree = { nodes?: unknown; treeVersion?: unknown; classId?: unknown; ascendClassId?: unknown; secondaryAscendClassId?: unknown; masteryEffects?: unknown };
      const before = await engine.getTree() as Tree;
      if (!before || !Array.isArray(before.nodes) || !before.nodes.every(node => Number.isSafeInteger(node))) throw new Error('PoB returned invalid tree state');
      const expected = new Set(before.nodes as number[]);
      for (const node of removeNodes) { if (!expected.delete(node)) throw new Error(`Node is not allocated: ${node}`); }
      for (const node of addNodes) { if (expected.has(node)) throw new Error(`Node is already allocated: ${node}`); expected.add(node); }
      for (const [node, effect] of Object.entries(masteryEffects)) {
        const option = await engine.getMasteryNodeOptions(Number(node));
        if (!option || option.nodeId !== Number(node) || option.allocated || !Array.isArray(option.availableEffects) ||
            !option.availableEffects.some(entry => entry.effectId === effect)) throw new Error(`Invalid new mastery effect: ${node}=${effect}`);
      }
      const result = await engine.updateTreeDelta({ addNodes, removeNodes, masteryEffects });
      const after = result.tree as Tree;
      if (!after || !Array.isArray(after.nodes) || after.nodes.length !== expected.size || after.nodes.some(node => !expected.has(node)) ||
          (result.droppedNodes?.length ?? 0) > 0 || before.treeVersion !== after.treeVersion || before.classId !== after.classId ||
          before.ascendClassId !== after.ascendClassId || before.secondaryAscendClassId !== after.secondaryAscendClassId) {
        throw new Error('PoB did not apply exactly the requested tree changes');
      }
      const masteryMap = (value: unknown): Record<string, unknown> => {
        // The Lua JSON encoder represents an empty table as []; nonempty arrays
        // are not a valid mastery-ID map and must not be silently normalized.
        if (Array.isArray(value)) {
          if (value.length) throw new Error('PoB returned an invalid mastery map');
          return {};
        }
        if (!value || typeof value !== 'object') throw new Error('PoB returned an invalid mastery map');
        return { ...value };
      };
      const oldMasteries = masteryMap(before.masteryEffects);
      for (const node of removeNodes) delete (oldMasteries as Record<string, unknown>)[String(node)];
      Object.assign(oldMasteries, masteryEffects);
      if (!isDeepStrictEqual(oldMasteries, masteryMap(after.masteryEffects))) throw new Error('PoB changed unrequested mastery effects');
      await engine.refreshTreeProgress();
    }, trial);
  }

  async masteryNodeOptions(id: string, nodeId: number) {
    if (!Number.isSafeInteger(nodeId) || nodeId < 1) throw new Error('Invalid mastery node ID');
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const tree = await engine.getTree() as { treeVersion?: unknown };
      const result = await engine.getMasteryNodeOptions(nodeId);
      if (!result || result.nodeId !== nodeId || !Array.isArray(result.availableEffects)) throw new Error('PoB returned invalid mastery node data');
      await engine.verifyIdentity();
      return { snapshotId: id, treeVersion: typeof tree?.treeVersion === 'string' ? tree.treeVersion : null,
        ...result, identity: engine.identity,
        warnings: [...warnings, 'Option data does not prove the node can be allocated or the effect is available in this build.'] };
    });
  }

  async masteryOptions(id: string) {
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const tree = await engine.getTree() as { treeVersion?: unknown };
      const result = await engine.getMasteryOptions();
      if (!result || !Array.isArray(result.masteries)) throw new Error('PoB returned invalid mastery options');
      await engine.verifyIdentity();
      return { snapshotId: id, treeVersion: typeof tree?.treeVersion === 'string' ? tree.treeVersion : null,
        masteries: result.masteries, identity: engine.identity,
        warnings: [...warnings, 'Only allocated mastery nodes are included; effects are PoB options, not a damage ranking.'] };
    });
  }

  async deriveMasteries(id: string, effects: Record<string, number>, trial = false): Promise<SnapshotRecord> {
    if (!effects || typeof effects !== 'object' || Array.isArray(effects) || !Object.keys(effects).length ||
        Object.keys(effects).length > 100 || Object.entries(effects).some(([node, effect]) => !/^[1-9][0-9]*$/.test(node) ||
          !Number.isSafeInteger(Number(node)) || !Number.isSafeInteger(effect) || effect < 1)) throw new Error('Invalid mastery changes');
    return this.derive(id, 'derived:masteries', async engine => {
      const before = await engine.getTree() as { nodes?: unknown; masteryEffects?: unknown; treeVersion?: unknown; classId?: unknown; ascendClassId?: unknown; secondaryAscendClassId?: unknown };
      const options = await engine.getMasteryOptions();
      if (!before || !Array.isArray(before.nodes) || !options || !Array.isArray(options.masteries)) throw new Error('PoB returned invalid mastery state');
      for (const [node, effect] of Object.entries(effects)) {
        const mastery = options.masteries.find(item => String(item.nodeId) === node);
        if (!mastery || !Array.isArray(mastery.availableEffects) || !mastery.availableEffects.some(item => item.effectId === effect)) throw new Error(`Invalid or unallocated mastery effect: ${node}=${effect}`);
      }
      const result = await engine.updateTreeDelta({ addNodes: [], removeNodes: [], masteryEffects: effects });
      const after = result.tree as typeof before;
      const validMap = (value: unknown): Record<string, unknown> => {
        if (Array.isArray(value) && !value.length) return {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PoB returned an invalid mastery map');
        return { ...value };
      };
      const expected = { ...validMap(before.masteryEffects), ...effects };
      if (!after || !isDeepStrictEqual(before.nodes, after.nodes) || !isDeepStrictEqual(expected, validMap(after.masteryEffects)) ||
          before.treeVersion !== after.treeVersion || before.classId !== after.classId || before.ascendClassId !== after.ascendClassId ||
          before.secondaryAscendClassId !== after.secondaryAscendClassId || (result.droppedNodes?.length ?? 0) > 0) {
        throw new Error('PoB did not apply exactly the requested mastery changes');
      }
      await engine.refreshTreeProgress();
    }, trial);
  }

  async deriveConfig(id: string, config: Record<string, string | number | boolean>, trial = false): Promise<SnapshotRecord> {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config');
    validateEvaluationOptions({ config });
    if (!Object.keys(config).length) throw new Error('Config change cannot be empty');
    return this.derive(id, 'derived:config', async engine => {
      const result = await engine.setConfig(config);
      if (Object.keys(result.rejected).length) throw new Error(`PoB rejected config: ${JSON.stringify(result.rejected)}`);
      const actual = await engine.getConfig();
      if (!actual || typeof actual !== 'object' || Array.isArray(actual) || !result.applied ||
          Object.keys(config).some(key => !Object.hasOwn(result.applied!, key) ||
            !isDeepStrictEqual((actual as Record<string, unknown>)[key], result.applied![key]))) {
        throw new Error('PoB did not confirm the requested config');
      }
    }, trial);
  }

  async readSnapshot(id: string) { return snapshotMetadata(await this.store.read(id)); }
  async retainSnapshot(id: string) { return this.store.retain(id); }
  async snapshotRetention(id: string) { return this.store.retentionStatus(id); }
  async listSnapshots(limit?: number, after?: string) { return this.store.list(limit, after); }
  async exportBuild(id: string): Promise<string> { return (await this.store.read(id)).xml; }
}
