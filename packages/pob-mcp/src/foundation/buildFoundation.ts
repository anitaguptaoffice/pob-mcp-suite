import { isDeepStrictEqual } from 'node:util';
import { SnapshotStore, snapshotMetadata, type SnapshotRecord } from './snapshotStore.js';
import { EngineLimiter } from './engineLimiter.js';
import { normalizeObservation } from './observation.js';
import { MAX_BUILD_BYTES, decodeShareCode } from './shareCode.js';
import { toFiniteNumber, type PoBLuaApiClient } from '../pobLuaBridge.js';

/** The adapter owns a disposable PoB instance; it must never share live state. */
export interface BuildEngine {
  queryTreePaths(params: { targetNodeId?: number; maxDistance?: number; limit?: number; filter?: string }): Promise<unknown>;
  getBuildNotes(): Promise<string>;
  setBuildNotes(notes: string): Promise<void>;
  identity: { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null };
  verifyIdentity(): Promise<void>;
  loadBuildXml(xml: string): Promise<unknown>;
  getStats(fields?: string[]): Promise<unknown>;
  setLevel(level: number): Promise<void>;
  setMainSelection(selection: { mainSocketGroup?: number; mainActiveSkill?: number; skillPart?: number }): Promise<void>;
  setCalcsSelection(groupIndex: number): Promise<void>;
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
  setGemLevel(params: { groupIndex: number; gemIndex: number; level: number }): Promise<void>;
  setGemQuality(params: { groupIndex: number; gemIndex: number; quality: number; qualityId?: string }): Promise<void>;
  setGemEnabled(params: { groupIndex: number; gemIndex: number; enabled: boolean }): Promise<void>;
  addGem(params: { groupIndex: number; gemName: string; level?: number; quality?: number; enabled?: boolean; count?: number; enableGlobal1?: boolean; enableGlobal2?: boolean; insertIndex?: number }): Promise<{ gemIndex: number; name?: string }>;
  removeGem(params: { groupIndex: number; gemIndex: number }): Promise<void>;
  createSocketGroup(params: { label?: string; slot?: string; enabled?: boolean; includeInFullDPS?: boolean }): Promise<{ index: number; label?: string }>;
  setSocketGroupEnabled(params: { groupIndex: number; enabled: boolean }): Promise<{ groupIndex: number; enabled: boolean }>;
  removeSkill(params: { groupIndex: number }): Promise<void>;
  setFlaskActive(index: number, active: boolean): Promise<void>;
  listItemSets(): Promise<{ activeItemSetId: number; itemSets: Array<{ id: number; title: string; active: boolean; useSecondWeaponSet: boolean }> }>;
  selectItemSet(id: number): Promise<{ activeItemSetId: number; itemSets: Array<{ id: number; title: string; active: boolean; useSecondWeaponSet: boolean }> }>;
  listSpecs(): Promise<{ activeSpec: number; specs: Array<{ index: number; title: string; active: boolean; className?: string; ascendClassName?: string; treeVersion?: string; nodeCount: number }> }>;
  selectSpec(index: number): Promise<{ activeSpec: number; specs: Array<{ index: number; title: string; active: boolean; className?: string; ascendClassName?: string; treeVersion?: string; nodeCount: number }> }>;
  createSpec(params: { title?: string; copyFrom?: number; activate?: boolean }): Promise<unknown>;
  renameSpec(index: number, title: string): Promise<unknown>;
  deleteSpec(index: number): Promise<unknown>;
  compareItem(slot: string, itemText: string): ReturnType<PoBLuaApiClient['compareItem']>;
  findTimelessJewelSeedsDetailed(params: Parameters<PoBLuaApiClient['findTimelessJewelSeedsDetailed']>[0]): ReturnType<PoBLuaApiClient['findTimelessJewelSeedsDetailed']>;
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

  async previewItem(id: string, slot: string, itemText: string) {
    if (typeof slot !== 'string' || !slot.trim() || slot.length > 100 || typeof itemText !== 'string' || !itemText.trim() || Buffer.byteLength(itemText, 'utf8') > 10240) throw new Error('Valid slot and item text up to 10 KB are required');
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const before = await observe(engine);
      const result = await engine.compareItem(slot.trim(), itemText);
      const after = await observe(engine);
      if (!isDeepStrictEqual(before, after)) throw new Error('PoB item preview changed the snapshot observation');
      if (!result || !result.baseline || typeof result.baseline !== 'object' || !result.candidateStats || typeof result.candidateStats !== 'object') throw new Error('PoB returned invalid item preview');
      const delta: Record<string, number> = {};
      for (const [key, value] of Object.entries(result.candidateStats)) {
        const previous = result.baseline[key];
        const difference = value - previous;
        if (typeof value === 'number' && Number.isFinite(value) && typeof previous === 'number' && Number.isFinite(previous) && Number.isFinite(difference)) delta[key] = difference;
      }
      await engine.verifyIdentity();
      return { snapshotId: id, identity: engine.identity, ...result, delta, warnings: [...warnings,
        'Values use the snapshot skill selection and configuration; player and minion damage are separate.',
        'This is a PoB item preview, not an equipment mutation or verification of item legality, availability or price.',
        'Candidate quality is preserved as parsed. Unsupported modifier diagnostics cover only the candidate and replaced item, not the whole build.',
        'PoB may not recognize every mechanic; inspect the item, sockets and requirements before relying on the result.'] };
    });
  }

  async runReadOnlySnapshot<T>(id: string, operation: (engine: BuildEngine) => Promise<T>) {
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const before = await observe(engine);
      const result = await operation(engine);
      const after = await observe(engine);
      if (!isDeepStrictEqual(before, after)) throw new Error('PoB read operation changed the snapshot observation');
      await engine.verifyIdentity();
      return { snapshotId: id, identity: engine.identity, warnings, result };
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

  private async derive(id: string, source: string, apply: (engine: BuildEngine) => Promise<void>, trial: boolean, verifyReload?: (engine: BuildEngine) => Promise<void>): Promise<SnapshotRecord> {
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
      if (verifyReload) {
        await verifyReload(engine);
        const afterVerification = await observe(engine);
        if (!isDeepStrictEqual(afterReload, afterVerification)) throw new Error('Reload verification changed the derived build state');
      }
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

  async deriveSelection(id: string, selection: NonNullable<EvaluationOptions['selection']>, trial = false): Promise<SnapshotRecord> {
    validateEvaluationOptions({ selection });
    if (!selection || !Object.keys(selection).length) throw new Error('Skill selection cannot be empty');
    return this.derive(id, 'derived:skill-selection', async engine => {
      const before = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      await engine.setMainSelection(selection);
      const after = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      const original = before.skills as { groups?: Array<{ index?: number }> };
      const updated = after.skills as { mainSocketGroup?: number; groups?: Array<{ index?: number; mainActiveSkill?: number; selectedSkillPart?: number }> };
      const group = updated?.groups?.find(entry => entry.index === updated.mainSocketGroup);
      if (!group || (selection.mainSocketGroup !== undefined && updated.mainSocketGroup !== selection.mainSocketGroup) ||
          (selection.mainActiveSkill !== undefined && group.mainActiveSkill !== selection.mainActiveSkill) ||
          (selection.skillPart !== undefined && group.selectedSkillPart !== selection.skillPart)) throw new Error('PoB did not confirm the requested skill selection');
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Skill selection changed unrelated ${section}`);
      if (!Array.isArray(original?.groups) || !Array.isArray(updated?.groups) ||
          !isDeepStrictEqual(original.groups.filter(entry => entry.index !== updated.mainSocketGroup), updated.groups.filter(entry => entry.index !== updated.mainSocketGroup))) throw new Error('Skill selection changed unrelated skill groups');
      const structuralGroup = (value: unknown) => {
        if (!value || typeof value !== 'object') return null;
        const { mainActiveSkill: _skill, selectedSkillPart: _part, ...rest } = value as Record<string, unknown>;
        if (Array.isArray(rest.gems)) rest.gems = rest.gems.map(gem => {
          if (!gem || typeof gem !== 'object') return gem;
          const { appliedToSelectedSkill: _applied, ...preserved } = gem as Record<string, unknown>;
          return preserved;
        });
        return rest;
      };
      if (!isDeepStrictEqual(structuralGroup(original.groups.find(entry => entry.index === updated.mainSocketGroup)), structuralGroup(group))) throw new Error('Skill selection changed unrelated selected group data');
    }, trial);
  }

  async deriveGem(id: string, groupIndex: number, gemIndex: number, changes: { level?: number; quality?: number; enabled?: boolean }, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 1 || !Number.isSafeInteger(gemIndex) || gemIndex < 1 || !changes || typeof changes !== 'object' || Array.isArray(changes) ||
        !Object.keys(changes).length || Object.keys(changes).some(key => !['level', 'quality', 'enabled'].includes(key)) ||
        (changes.level !== undefined && (!Number.isInteger(changes.level) || changes.level < 1 || changes.level > 40)) ||
        (changes.quality !== undefined && (!Number.isInteger(changes.quality) || changes.quality < 0 || changes.quality > 99)) ||
        (changes.enabled !== undefined && typeof changes.enabled !== 'boolean') || Object.values(changes).some(value => value === undefined)) throw new Error('Invalid gem change');
    return this.derive(id, 'derived:gem', async engine => {
      const before = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      type Gem = Record<string, unknown> & { index?: number };
      type Group = { index?: number; gems?: Gem[] };
      const groups = (value: unknown): Group[] => {
        const list = (value as { groups?: Group[] })?.groups;
        if (!Array.isArray(list) || list.some((group, i) => group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const original = groups(before.skills);
      const target = original.find(group => group.index === groupIndex)?.gems?.find(gem => gem.index === gemIndex);
      if (!target) throw new Error('Gem not found in requested group');
      if (changes.level !== undefined) await engine.setGemLevel({ groupIndex, gemIndex, level: changes.level });
      if (changes.quality !== undefined) await engine.setGemQuality({ groupIndex, gemIndex, quality: changes.quality });
      if (changes.enabled !== undefined) await engine.setGemEnabled({ groupIndex, gemIndex, enabled: changes.enabled });
      const after = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Gem change modified unrelated ${section}`);
      const updated = groups(after.skills);
      const actual = updated.find(group => group.index === groupIndex)?.gems?.find(gem => gem.index === gemIndex);
      if (!actual || Object.entries(changes).some(([key, value]) => actual[key] !== value)) throw new Error('PoB did not confirm requested gem changes');
      const canonical = (list: Group[]) => list.map(group => ({ ...group, ...(group.index === groupIndex ? { skills: undefined, selectedSkillPart: undefined } : {}), gems: group.gems!.map(gem => {
        const copy = { ...gem };
        delete copy.appliedToSelectedSkill;
        if (group.index === groupIndex && gem.index === gemIndex) for (const key of Object.keys(changes)) delete copy[key];
        return copy;
      }) }));
      if (!isDeepStrictEqual(canonical(original), canonical(updated))) throw new Error('Gem change modified unrelated skill or gem data');
    }, trial);
  }

  async deriveGemList(id: string, groupIndex: number, operation: { type: 'add'; gemName: string; level?: number; quality?: number; enabled?: boolean; count?: number; enableGlobal1?: boolean; enableGlobal2?: boolean; insertIndex?: number } | { type: 'remove'; gemIndex: number }, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 1 || !operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Invalid gem operation');
    const validInt = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
    if (operation.type === 'add') {
      if (Object.keys(operation).some(key => !['type', 'gemName', 'level', 'quality', 'enabled', 'count', 'enableGlobal1', 'enableGlobal2', 'insertIndex'].includes(key)) ||
          typeof operation.gemName !== 'string' || !operation.gemName.trim() || operation.gemName.length > 200 ||
          (operation.level !== undefined && !validInt(operation.level, 1, 40)) || (operation.quality !== undefined && !validInt(operation.quality, 0, 99)) ||
          (operation.count !== undefined && !validInt(operation.count, 1, 10000)) || (operation.insertIndex !== undefined && !validInt(operation.insertIndex, 1, 10000)) ||
          [operation.enabled, operation.enableGlobal1, operation.enableGlobal2].some(value => value !== undefined && typeof value !== 'boolean') || Object.values(operation).some(value => value === undefined)) throw new Error('Invalid gem addition');
    } else if (operation.type !== 'remove' || Object.keys(operation).some(key => !['type', 'gemIndex'].includes(key)) || !validInt(operation.gemIndex, 1, 10000)) throw new Error('Invalid gem removal');
    return this.derive(id, `derived:gem-${operation.type}`, async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      const before = await read();
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[] };
      const readGroups = (skills: unknown): Group[] => {
        const list = (skills as { groups?: Group[] })?.groups;
        if (!Array.isArray(list) || list.some((group, i) => group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const original = readGroups(before.skills), oldGroup = original.find(group => group.index === groupIndex);
      if (!oldGroup?.gems) throw new Error('Skill group not found');
      let index: number;
      let addedName: string | undefined;
      if (operation.type === 'add') {
        index = operation.insertIndex ?? oldGroup.gems.length + 1;
        if (index > oldGroup.gems.length + 1) throw new Error('Invalid gem insertion position');
        const { type: _type, ...params } = operation;
        const added = await engine.addGem({ ...params, groupIndex });
        if (added.gemIndex !== index || typeof added.name !== 'string' || !added.name) throw new Error('PoB did not confirm the inserted gem');
        addedName = added.name;
      } else {
        index = operation.gemIndex;
        if (!oldGroup.gems.find(gem => gem.index === index)) throw new Error('Gem not found in requested group');
        await engine.removeGem({ groupIndex, gemIndex: index });
      }
      const after = await read();
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Gem operation modified unrelated ${section}`);
      for (const key of ['mainSocketGroup', 'calcsSkillNumber']) if ((before.skills as Record<string, unknown>)[key] !== (after.skills as Record<string, unknown>)[key]) throw new Error(`Gem operation modified unrelated ${key}`);
      const updated = readGroups(after.skills), newGroup = updated.find(group => group.index === groupIndex);
      const newGem = newGroup?.gems?.find(gem => gem.index === index);
      if (operation.type === 'add' && (!newGem || newGem.name !== addedName || newGem.level !== (operation.level ?? 20) || newGem.quality !== (operation.quality ?? 0) || newGem.enabled !== (operation.enabled ?? true) || newGem.count !== (operation.count ?? 1) || newGem.enableGlobal1 !== (operation.enableGlobal1 ?? true) || newGem.enableGlobal2 !== (operation.enableGlobal2 ?? false) || newGem.qualityId !== 'Default')) throw new Error('PoB did not confirm the requested gem properties');
      const canonical = (list: Group[], omit: boolean) => list.map(group => ({ ...group, ...(group.index === groupIndex ? { skills: undefined, selectedSkillPart: undefined } : {}), gems: group.gems!.filter(gem => !(omit && group.index === groupIndex && gem.index === index)).map(gem => {
        const copy = { ...gem }; delete copy.index; delete copy.appliedToSelectedSkill; return copy;
      }) }));
      if (!isDeepStrictEqual(canonical(original, operation.type === 'remove'), canonical(updated, operation.type === 'add'))) throw new Error('Gem operation modified unrelated skill or gem data');
    }, trial);
  }

  async deriveSkillGroup(id: string, group: { label?: string; slot?: string; enabled?: boolean; includeInFullDPS?: boolean }, gems: Array<{ gemName: string; level?: number; quality?: number; enabled?: boolean }>, trial = false): Promise<SnapshotRecord> {
    if (!group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['label', 'slot', 'enabled', 'includeInFullDPS'].includes(key)) ||
        (group.label !== undefined && (typeof group.label !== 'string' || group.label.length > 200)) || (group.slot !== undefined && (typeof group.slot !== 'string' || !group.slot.trim() || group.slot.length > 100)) ||
        [group.enabled, group.includeInFullDPS].some(value => value !== undefined && typeof value !== 'boolean') || Object.values(group).some(value => value === undefined) ||
        !Array.isArray(gems) || gems.length > 30 || gems.some(gem => !gem || typeof gem !== 'object' || Array.isArray(gem) || Object.keys(gem).some(key => !['gemName', 'level', 'quality', 'enabled'].includes(key)) ||
          typeof gem.gemName !== 'string' || !gem.gemName.trim() || gem.gemName.length > 200 || (gem.level !== undefined && (!Number.isInteger(gem.level) || gem.level < 1 || gem.level > 40)) ||
          (gem.quality !== undefined && (!Number.isInteger(gem.quality) || gem.quality < 0 || gem.quality > 99)) || (gem.enabled !== undefined && typeof gem.enabled !== 'boolean') || Object.values(gem).some(value => value === undefined))) throw new Error('Invalid skill group or gems');
    return this.derive(id, 'derived:skill-group', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      const before = await read();
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[] };
      const groups = (skills: unknown): Group[] => {
        const result = (skills as { groups?: Group[] })?.groups;
        if (!Array.isArray(result) || result.some((entry, i) => entry.index !== i + 1 || !Array.isArray(entry.gems) || entry.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return result;
      };
      const original = groups(before.skills);
      const created = await engine.createSocketGroup(group);
      if (created.index !== original.length + 1) throw new Error('PoB did not confirm the new skill group index');
      const names: string[] = [];
      for (const [index, gem] of gems.entries()) {
        const added = await engine.addGem({ ...gem, groupIndex: created.index });
        if (added.gemIndex !== index + 1 || typeof added.name !== 'string' || !added.name) throw new Error('PoB did not confirm the new gem');
        names.push(added.name);
      }
      const after = await read();
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Skill group creation modified unrelated ${section}`);
      for (const key of ['mainSocketGroup', 'calcsSkillNumber']) if ((before.skills as Record<string, unknown>)[key] !== (after.skills as Record<string, unknown>)[key]) throw new Error(`Skill group creation modified unrelated ${key}`);
      const updated = groups(after.skills), createdGroup = updated.at(-1);
      if (updated.length !== original.length + 1 || !createdGroup || createdGroup.index !== created.index || createdGroup.label !== (group.label ?? '') ||
          (group.slot !== undefined && createdGroup.slot !== group.slot) || createdGroup.enabled !== (group.enabled ?? true) || createdGroup.includeInFullDPS !== (group.includeInFullDPS ?? false) || createdGroup.gems?.length !== gems.length ||
          gems.some((gem, i) => { const actual = createdGroup.gems?.[i]; return !actual || actual.name !== names[i] || actual.level !== (gem.level ?? 20) || actual.quality !== (gem.quality ?? 0) || actual.enabled !== (gem.enabled ?? true) || actual.qualityId !== 'Default'; })) throw new Error('PoB did not confirm the requested skill group and gems');
      const canonical = (list: Group[]) => list.map(entry => ({ ...entry, gems: entry.gems!.map(gem => { const copy = { ...gem }; delete copy.appliedToSelectedSkill; return copy; }) }));
      if (!isDeepStrictEqual(canonical(original), canonical(updated.slice(0, -1)))) throw new Error('Skill group creation modified existing skill groups');
    }, trial);
  }

  async deriveSkillGroupEnabled(id: string, groupIndex: number, enabled: boolean, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 1 || typeof enabled !== 'boolean') throw new Error('Invalid skill group enable change');
    return this.derive(id, 'derived:skill-group-enabled', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[]; enabled?: boolean };
      const groups = (value: unknown): Group[] => {
        const list = (value as { groups?: Group[] })?.groups;
        if (!Array.isArray(list) || list.some((group, index) => group.index !== index + 1 || !Array.isArray(group.gems) || group.gems.some((gem, i) => gem.index !== i + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const before = await read();
      const original = groups(before.skills);
      if (!original.find(group => group.index === groupIndex)) throw new Error('Skill group not found');
      const result = await engine.setSocketGroupEnabled({ groupIndex, enabled });
      if (result.groupIndex !== groupIndex || result.enabled !== enabled) throw new Error('PoB did not confirm the skill group change');
      const after = await read();
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Skill group change modified unrelated ${section}`);
      for (const key of ['mainSocketGroup', 'calcsSkillNumber']) if ((before.skills as Record<string, unknown>)[key] !== (after.skills as Record<string, unknown>)[key]) throw new Error(`Skill group change modified unrelated ${key}`);
      const updated = groups(after.skills);
      if (updated.find(group => group.index === groupIndex)?.enabled !== enabled) throw new Error('PoB did not confirm the skill group state');
      const canonical = (list: Group[]) => list.map(group => ({ ...group, ...(group.index === groupIndex ? { enabled: undefined, skills: undefined, selectedSkillPart: undefined } : {}), gems: group.gems!.map(gem => { const copy = { ...gem }; delete copy.appliedToSelectedSkill; return copy; }) }));
      if (!isDeepStrictEqual(canonical(original), canonical(updated))) throw new Error('Skill group change modified unrelated skill or gem data');
    }, trial);
  }

  async deriveRemoveSkillGroup(id: string, groupIndex: number, replacementMainGroup?: number, trial = false, replacementCalcsGroup?: number): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 1 || (replacementMainGroup !== undefined && (!Number.isSafeInteger(replacementMainGroup) || replacementMainGroup < 1)) || (replacementCalcsGroup !== undefined && (!Number.isSafeInteger(replacementCalcsGroup) || replacementCalcsGroup < 1))) throw new Error('Invalid skill group removal');
    return this.derive(id, 'derived:remove-skill-group', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[] };
      type Skills = { mainSocketGroup?: number; calcsSkillNumber?: number; groups?: Group[] };
      const groups = (value: unknown): Group[] => {
        const list = (value as Skills)?.groups;
        if (!Array.isArray(list) || list.some((group, i) => group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const before = await read(), skills = before.skills as Skills, original = groups(before.skills);
      if (groupIndex > original.length) throw new Error('Skill group not found');
      const selected = skills.mainSocketGroup;
      if (!Number.isSafeInteger(selected) || !selected || selected < 1 || selected > original.length) throw new Error('Current main skill group is unavailable');
      const remaining = original.length - 1;
      if (groupIndex === selected && remaining > 0 && replacementMainGroup === undefined) throw new Error('replacement_main_group is required when removing the main group');
      if ((groupIndex !== selected || remaining === 0) && replacementMainGroup !== undefined) throw new Error('replacement_main_group is only accepted when removing the main group with groups remaining');
      if (replacementMainGroup !== undefined && replacementMainGroup > remaining) throw new Error('Replacement main group is out of range after removal');
      const newMain = groupIndex === selected ? replacementMainGroup : selected - (groupIndex < selected ? 1 : 0);
      const calcs = skills.calcsSkillNumber;
      if (remaining > 0 && (!Number.isSafeInteger(calcs) || !calcs || calcs < 1 || calcs > original.length)) throw new Error('Current calculation-tab skill group is unavailable');
      if (replacementCalcsGroup !== undefined && (remaining === 0 || calcs !== groupIndex || calcs === selected)) throw new Error('replacement_calcs_group is only accepted when removing a separately selected calculation group');
      if (replacementCalcsGroup !== undefined && replacementCalcsGroup > remaining) throw new Error('Replacement calculation group is out of range after removal');
      if (remaining > 0 && calcs === groupIndex && calcs !== selected && replacementCalcsGroup === undefined) throw new Error('replacement_calcs_group is required when removing the separately selected calculation group');
      const newCalcs = remaining === 0 ? undefined : calcs === groupIndex ? (calcs === selected ? newMain : replacementCalcsGroup) : calcs! - (groupIndex < calcs! ? 1 : 0);
      await engine.removeSkill({ groupIndex });
      if (remaining > 0 && newMain !== selected) await engine.setMainSelection({ mainSocketGroup: newMain });
      if (remaining > 0 && (newCalcs !== calcs || newMain !== selected)) await engine.setCalcsSelection(newCalcs!);
      const after = await read();
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Skill group removal modified unrelated ${section}`);
      const result = after.skills as Skills, updated = groups(after.skills);
      if (remaining > 0 && result.mainSocketGroup !== newMain) throw new Error('PoB did not confirm the main skill group after removal');
      if (remaining > 0 && result.calcsSkillNumber !== newCalcs) throw new Error('PoB did not confirm the calculation-tab selection after removal');
      const canonical = (list: Group[]) => list.map(group => { const copy = { ...group }; delete copy.index; copy.gems = group.gems!.map(gem => { const item = { ...gem }; delete item.appliedToSelectedSkill; return item; }); return copy; });
      if (!isDeepStrictEqual(canonical(original.filter(group => group.index !== groupIndex)), canonical(updated))) throw new Error('Skill group removal modified remaining groups');
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

  async deriveFlaskActive(id: string, flaskIndex: number, active: boolean, trial = false): Promise<SnapshotRecord> {
    if (!Number.isInteger(flaskIndex) || flaskIndex < 1 || flaskIndex > 5 || typeof active !== 'boolean') throw new Error('Invalid flask state');
    return this.derive(id, 'derived:flask-active', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig() });
      type Item = Record<string, unknown> & { slot?: string; active?: boolean };
      const before = await read();
      const slot = `Flask ${flaskIndex}`;
      if (!Array.isArray(before.items) || before.items.filter((item: Item) => item.slot === slot).length !== 1) throw new Error('Requested flask slot is unavailable');
      await engine.setFlaskActive(flaskIndex, active);
      const after = await read();
      if (!Array.isArray(after.items) || after.items.filter((item: Item) => item.slot === slot).length !== 1 || after.items.find((item: Item) => item.slot === slot).active !== active) throw new Error('PoB did not confirm the requested flask state');
      for (const section of ['tree', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Flask state change modified unrelated ${section}`);
      const canonical = (items: Item[]) => items.map(item => { const copy = { ...item }; if (item.slot === slot) delete copy.active; return copy; });
      if (!isDeepStrictEqual(canonical(before.items), canonical(after.items))) throw new Error('Flask state change modified unrelated item data');
    }, trial);
  }

  private async readItemSetCatalog(engine: BuildEngine) {
    const result = await engine.listItemSets();
    if (!result || !Number.isSafeInteger(result.activeItemSetId) || result.activeItemSetId < 1 || !Array.isArray(result.itemSets) || result.itemSets.length < 1 || result.itemSets.length > 100 ||
        result.itemSets.some(set => !Number.isSafeInteger(set.id) || set.id < 1 || typeof set.title !== 'string' || typeof set.active !== 'boolean' || typeof set.useSecondWeaponSet !== 'boolean') ||
        new Set(result.itemSets.map(set => set.id)).size !== result.itemSets.length || result.itemSets.filter(set => set.active).length !== 1 || !result.itemSets.some(set => set.id === result.activeItemSetId && set.active)) throw new Error('PoB returned invalid item set catalog');
    return result;
  }

  async itemSets(id: string) {
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const catalog = await this.readItemSetCatalog(engine);
      await engine.verifyIdentity();
      return { snapshotId: id, ...catalog, identity: engine.identity, warnings };
    });
  }

  async deriveItemSet(id: string, itemSetId: number, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(itemSetId) || itemSetId < 1) throw new Error('Invalid item set ID');
    let expected: Array<{ id: number; items: unknown }> = [];
    let catalogBefore: Awaited<ReturnType<BuildFoundation['readItemSetCatalog']>>;
    const inspectAll = async (engine: BuildEngine, catalog: typeof catalogBefore, restoreId: number) => {
      const results = [];
      for (const itemSet of catalog.itemSets) {
        await engine.selectItemSet(itemSet.id);
        if ((await this.readItemSetCatalog(engine)).activeItemSetId !== itemSet.id) throw new Error('PoB did not confirm item set selection');
        const items = normalizeObservation({ items: await engine.getItems() }).items;
        if (!Array.isArray(items)) throw new Error('PoB returned invalid equipment');
        results.push({ id: itemSet.id, items });
      }
      await engine.selectItemSet(restoreId);
      if ((await this.readItemSetCatalog(engine)).activeItemSetId !== restoreId) throw new Error('PoB did not restore selected item set');
      return results;
    };
    return this.derive(id, 'derived:item-set', async engine => {
      catalogBefore = await this.readItemSetCatalog(engine);
      if (!catalogBefore.itemSets.some(set => set.id === itemSetId)) throw new Error('Item set not found');
      expected = await inspectAll(engine, catalogBefore, itemSetId);
      const selected = await this.readItemSetCatalog(engine);
      if (selected.activeItemSetId !== itemSetId) throw new Error('PoB did not confirm requested item set');
      const withoutActive = (catalog: typeof catalogBefore) => catalog.itemSets.map(({ active: _active, ...rest }) => rest);
      if (!isDeepStrictEqual(withoutActive(catalogBefore), withoutActive(selected))) throw new Error('Item set selection modified the catalog');
    }, trial, async engine => {
      const reloaded = await this.readItemSetCatalog(engine);
      if (reloaded.activeItemSetId !== itemSetId || !isDeepStrictEqual(catalogBefore.itemSets.map(({ active: _active, ...rest }) => rest), reloaded.itemSets.map(({ active: _active, ...rest }) => rest))) throw new Error('Item set catalog did not survive serialization');
      if (!isDeepStrictEqual(expected, await inspectAll(engine, reloaded, itemSetId))) throw new Error('Item set equipment did not survive serialization');
    });
  }

  private async readSpecCatalog(engine: BuildEngine) {
    const result = await engine.listSpecs();
    if (!result || !Number.isSafeInteger(result.activeSpec) || result.activeSpec < 1 || !Array.isArray(result.specs) || result.specs.length < 1 || result.specs.length > 100 ||
        result.specs.some((spec, i) => spec.index !== i + 1 || typeof spec.title !== 'string' || typeof spec.active !== 'boolean' || !Number.isSafeInteger(spec.nodeCount) || spec.nodeCount < 0) ||
        result.specs.filter(spec => spec.active).length !== 1 || !result.specs.some(spec => spec.index === result.activeSpec && spec.active)) throw new Error('PoB returned invalid passive spec catalog');
    return result;
  }

  async specs(id: string) {
    const snapshot = await this.store.read(id);
    return this.limiter.withEngine(async engine => {
      const warnings = checkIdentity(snapshot, engine);
      await engine.loadBuildXml(snapshot.xml);
      const catalog = await this.readSpecCatalog(engine);
      await engine.verifyIdentity();
      return { snapshotId: id, ...catalog, identity: engine.identity, warnings };
    });
  }

  private async inspectSpecs(engine: BuildEngine, catalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>, restoreIndex: number) {
    const results = [];
    for (const spec of catalog.specs) {
      await engine.selectSpec(spec.index);
      if ((await this.readSpecCatalog(engine)).activeSpec !== spec.index) throw new Error('PoB did not confirm passive spec selection');
      const tree = await engine.getTree();
      if (!tree || typeof tree !== 'object' || Array.isArray(tree) || !Array.isArray((tree as { nodes?: unknown }).nodes)) throw new Error('PoB returned invalid passive tree');
      const items = normalizeObservation({ items: await engine.getItems() }).items;
      if (!Array.isArray(items)) throw new Error('PoB returned invalid equipment');
      results.push({ index: spec.index, tree, items });
    }
    await engine.selectSpec(restoreIndex);
    if ((await this.readSpecCatalog(engine)).activeSpec !== restoreIndex) throw new Error('PoB did not restore selected passive spec');
    return results;
  }

  async deriveSpec(id: string, specIndex: number, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(specIndex) || specIndex < 1) throw new Error('Invalid passive spec index');
    let expected: Array<{ index: number; tree: unknown; items: unknown }> = [];
    let catalogBefore: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    return this.derive(id, 'derived:passive-spec', async engine => {
      catalogBefore = await this.readSpecCatalog(engine);
      if (!catalogBefore.specs.some(spec => spec.index === specIndex)) throw new Error('Passive spec not found');
      expected = await this.inspectSpecs(engine, catalogBefore, specIndex);
      const selected = await this.readSpecCatalog(engine);
      const withoutActive = (catalog: typeof catalogBefore) => catalog.specs.map(({ active: _active, ...rest }) => rest);
      if (selected.activeSpec !== specIndex || !isDeepStrictEqual(withoutActive(catalogBefore), withoutActive(selected))) throw new Error('Passive spec selection modified the catalog');
    }, trial, async engine => {
      const reloaded = await this.readSpecCatalog(engine);
      if (reloaded.activeSpec !== specIndex || !isDeepStrictEqual(catalogBefore.specs.map(({ active: _active, ...rest }) => rest), reloaded.specs.map(({ active: _active, ...rest }) => rest))) throw new Error('Passive spec catalog did not survive serialization');
      if (!isDeepStrictEqual(expected, await this.inspectSpecs(engine, reloaded, specIndex))) throw new Error('Passive specs did not survive serialization');
    });
  }

  async deriveCreateSpec(id: string, params: { title?: string; copyFrom?: number; activate?: boolean }, trial = false): Promise<SnapshotRecord> {
    if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => !['title', 'copyFrom', 'activate'].includes(key)) ||
        (params.title !== undefined && (typeof params.title !== 'string' || !params.title.trim() || params.title.length > 200)) ||
        (params.copyFrom !== undefined && (!Number.isSafeInteger(params.copyFrom) || params.copyFrom < 1)) ||
        (params.activate !== undefined && typeof params.activate !== 'boolean') || Object.values(params).some(value => value === undefined)) throw new Error('Invalid passive spec creation');
    let expected: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let catalogAfter: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    return this.derive(id, 'derived:create-spec', async engine => {
      const before = await this.readSpecCatalog(engine);
      if (before.specs.length >= 100) throw new Error('Passive spec limit reached');
      if (params.copyFrom !== undefined && !before.specs.some(spec => spec.index === params.copyFrom)) throw new Error('Source passive spec not found');
      const previous = await this.inspectSpecs(engine, before, before.activeSpec);
      await engine.createSpec(params);
      catalogAfter = await this.readSpecCatalog(engine);
      const newIndex = before.specs.length + 1, expectedActive = params.activate === false ? before.activeSpec : newIndex;
      const withoutActive = (catalog: typeof before) => catalog.specs.map(({ active: _active, ...rest }) => rest);
      if (catalogAfter.activeSpec !== expectedActive || catalogAfter.specs.length !== newIndex ||
          !isDeepStrictEqual(withoutActive(before), withoutActive(catalogAfter).slice(0, -1)) ||
          (params.title !== undefined && catalogAfter.specs[newIndex - 1].title !== params.title)) throw new Error('PoB did not confirm passive spec creation');
      expected = await this.inspectSpecs(engine, catalogAfter, expectedActive);
      if (!isDeepStrictEqual(previous, expected.slice(0, -1))) throw new Error('Passive spec creation modified existing specs');
      if (params.copyFrom !== undefined) {
        const source = expected[params.copyFrom - 1], created = expected[newIndex - 1];
        if (!isDeepStrictEqual(source.tree, created.tree) || !isDeepStrictEqual(source.items, created.items)) throw new Error('PoB did not preserve the copied passive spec');
      }
    }, trial, async engine => {
      const catalog = await this.readSpecCatalog(engine);
      if (!isDeepStrictEqual(catalog, catalogAfter) || !isDeepStrictEqual(expected, await this.inspectSpecs(engine, catalog, catalog.activeSpec))) throw new Error('Created passive specs did not survive serialization');
    });
  }

  async deriveRenameSpec(id: string, index: number, title: string, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(index) || index < 1 || typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Invalid passive spec rename');
    let expected: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let catalogAfter: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    return this.derive(id, 'derived:rename-spec', async engine => {
      const before = await this.readSpecCatalog(engine);
      if (!before.specs.some(spec => spec.index === index)) throw new Error('Passive spec not found');
      const previous = await this.inspectSpecs(engine, before, before.activeSpec);
      await engine.renameSpec(index, title);
      catalogAfter = await this.readSpecCatalog(engine);
      const intended = structuredClone(before); intended.specs[index - 1].title = title;
      if (!isDeepStrictEqual(catalogAfter, intended)) throw new Error('PoB did not confirm the requested passive spec name');
      expected = await this.inspectSpecs(engine, catalogAfter, catalogAfter.activeSpec);
      if (!isDeepStrictEqual(expected, previous)) throw new Error('Passive spec rename modified tree or equipment');
    }, trial, async engine => {
      const catalog = await this.readSpecCatalog(engine);
      if (!isDeepStrictEqual(catalog, catalogAfter) || !isDeepStrictEqual(expected, await this.inspectSpecs(engine, catalog, catalog.activeSpec))) throw new Error('Renamed passive specs did not survive serialization');
    });
  }

  async deriveDeleteSpec(id: string, index: number, replacementSpec?: number, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(index) || index < 1 || (replacementSpec !== undefined && (!Number.isSafeInteger(replacementSpec) || replacementSpec < 1))) throw new Error('Invalid passive spec deletion');
    let expected: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let catalogAfter: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    return this.derive(id, 'derived:delete-spec', async engine => {
      const before = await this.readSpecCatalog(engine);
      if (index > before.specs.length) throw new Error('Passive spec not found');
      if (before.specs.length <= 1) throw new Error('Cannot delete the only passive spec');
      if (index === before.activeSpec && replacementSpec === undefined) throw new Error('replacement_spec is required when deleting the active passive spec');
      if (index !== before.activeSpec && replacementSpec !== undefined) throw new Error('replacement_spec is only accepted when deleting the active passive spec');
      if (replacementSpec !== undefined && replacementSpec >= before.specs.length) throw new Error('Replacement passive spec is out of range after deletion');
      const wanted = index === before.activeSpec ? replacementSpec! : before.activeSpec - (index < before.activeSpec ? 1 : 0);
      const previous = await this.inspectSpecs(engine, before, before.activeSpec);
      await engine.deleteSpec(index);
      if ((await this.readSpecCatalog(engine)).activeSpec !== wanted) await engine.selectSpec(wanted);
      catalogAfter = await this.readSpecCatalog(engine);
      const originalCatalog = before.specs.filter(spec => spec.index !== index).map((spec, i) => ({ ...spec, index: i + 1, active: i + 1 === wanted }));
      if (catalogAfter.activeSpec !== wanted || !isDeepStrictEqual(catalogAfter.specs, originalCatalog)) throw new Error('PoB did not confirm passive spec deletion');
      expected = await this.inspectSpecs(engine, catalogAfter, wanted);
      const surviving = previous.filter(spec => spec.index !== index).map((spec, i) => ({ ...spec, index: i + 1 }));
      if (!isDeepStrictEqual(expected, surviving)) throw new Error('Passive spec deletion modified surviving specs');
    }, trial, async engine => {
      const catalog = await this.readSpecCatalog(engine);
      if (!isDeepStrictEqual(catalog, catalogAfter) || !isDeepStrictEqual(expected, await this.inspectSpecs(engine, catalog, catalog.activeSpec))) throw new Error('Remaining passive specs did not survive serialization');
    });
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

  async notes(id: string) {
    const { result, ...context } = await this.runReadOnlySnapshot(id, engine => engine.getBuildNotes());
    if (typeof result !== 'string') throw new Error('PoB returned invalid notes');
    return { ...context, notes: result };
  }

  async deriveNotes(id: string, notes: string, trial = false): Promise<SnapshotRecord> {
    if (typeof notes !== 'string' || Buffer.byteLength(notes, 'utf8') > 512 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(notes)) throw new Error('Notes must be valid XML text of at most 512 KiB');
    const verify = async (engine: BuildEngine) => {
      if (await engine.getBuildNotes() !== notes) throw new Error('PoB did not preserve the requested notes');
    };
    return this.derive(id, 'derived:notes', async engine => {
      const before = await observe(engine);
      await engine.setBuildNotes(notes);
      await verify(engine);
      if (!isDeepStrictEqual(before, await observe(engine))) throw new Error('Notes change modified unrelated build state');
    }, trial, verify);
  }

  async readSnapshot(id: string) { return snapshotMetadata(await this.store.read(id)); }
  async retainSnapshot(id: string) { return this.store.retain(id); }
  async snapshotRetention(id: string) { return this.store.retentionStatus(id); }
  async listSnapshots(limit?: number, after?: string) { return this.store.list(limit, after); }
  async exportBuild(id: string): Promise<string> { return (await this.store.read(id)).xml; }
}
