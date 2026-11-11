import { isDeepStrictEqual } from 'node:util';
import { SnapshotStore, snapshotMetadata, type SnapshotRecord, type SnapshotHistoryInput } from './snapshotStore.js';
import { EngineLimiter } from './engineLimiter.js';
import { normalizeItemRaw, normalizeObservation } from './observation.js';
import { MAX_BUILD_BYTES, decodeShareCode } from './shareCode.js';
import { toFiniteNumber } from '../utils/numbers.js';
import type { BuildEngine } from '../ports/pobEngine.js';
import type { EnemyLevelSetting } from '../ports/configPresets.js';
import { validEnemyLevelSetting } from '../domain/configPreset.js';
import { BuildXml } from '../utils/buildXml.js';

export type { BuildEngine } from '../ports/pobEngine.js';

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
function hasLegacyGemQuality(xml: string): boolean {
  return xml.includes('qualityId') && new BuildXml(xml).hasNonDefaultGemQuality();
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
  if (hasLegacyGemQuality(snapshot.xml)) warnings.push('Source XML contains non-default gem qualityId fields; PoB may ignore them, so skill observations and calculations may not represent the original build.');
  return warnings;
}
async function observe(engine: BuildEngine) {
  return normalizeObservation({ info: await engine.getBuildInfo(), tree: await engine.getTree(),
    items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig(),
    stats: await engine.getStats(['Life', 'EnergyShield', 'TotalEHP', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS']) });
}
const canonicalInventory = (items: Array<{ id: number; raw: string }>) => items.map(item => ({ ...item, raw: normalizeItemRaw(item.raw) }));

export class BuildFoundation {
  private readonly limiter: EngineLimiter<BuildEngine>;
  constructor(private readonly store: SnapshotStore, openEngine: () => Promise<BuildEngine>, limiter?: EngineLimiter<BuildEngine>) {
    this.limiter = limiter ?? new EngineLimiter(openEngine);
  }

  async createBuild(className: string, ascendancy?: string, treeVersion?: string): Promise<SnapshotRecord> {
    if (typeof className !== 'string' || !className.trim() || className !== className.trim() || className.length > 100 ||
        (ascendancy !== undefined && (typeof ascendancy !== 'string' || !ascendancy.trim() || ascendancy !== ascendancy.trim() || ascendancy.length > 100)) ||
        (treeVersion !== undefined && (typeof treeVersion !== 'string' || !/^\d+_\d+[A-Za-z0-9_]*$/.test(treeVersion) || treeVersion.length > 60))) throw new Error('Valid class, optional ascendancy and tree version are required');
    return this.limiter.withEngine(async engine => {
      await engine.newBuild({ className, ascendancy, treeVersion });
      const tree = await engine.getTree() as { className?: unknown; ascendClassName?: unknown; treeVersion?: unknown };
      const same = (actual: unknown, requested: string) => typeof actual === 'string' && actual.toLowerCase() === requested.toLowerCase();
      if (!tree || !same(tree.className, className) || (treeVersion && tree.treeVersion !== treeVersion) || (ascendancy && ascendancy.toLowerCase() !== 'none' && !same(tree.ascendClassName, ascendancy)) || ((!ascendancy || ascendancy.toLowerCase() === 'none') && tree.ascendClassName && !same(tree.ascendClassName, 'none'))) throw new Error('PoB did not confirm the requested class, ascendancy and tree version');
      const { xml } = await engine.captureSnapshot();
      if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > MAX_BUILD_BYTES) throw new Error('PoB returned invalid build XML');
      await engine.loadBuildXml(xml);
      if (!isDeepStrictEqual(normalizeObservation(await engine.getTree()), normalizeObservation(tree))) throw new Error('PoB did not preserve the new tree on reload');
      await engine.verifyIdentity();
      return this.store.create({ xml, source: 'new-build', parentId: null, ...engine.identity });
    });
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
      if (!isDeepStrictEqual(before, after)) {
        const changed = Object.keys(before).filter(key => !isDeepStrictEqual(before[key as keyof typeof before], after[key as keyof typeof after]));
        throw new Error(`PoB read operation changed the snapshot observation: ${changed.join(', ')}`);
      }
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
    if (hasLegacyGemQuality(parent.xml)) throw new Error('Cannot derive snapshot: source XML contains a non-default gem qualityId that PoB may discard. Original snapshot remains unchanged.');
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

  async deriveGem(id: string, groupIndex: number, gemIndex: number, changes: { level?: number; quality?: number; qualityId?: 'Default'; enabled?: boolean }, trial = false): Promise<SnapshotRecord> {
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 1 || !Number.isSafeInteger(gemIndex) || gemIndex < 1 || !changes || typeof changes !== 'object' || Array.isArray(changes) ||
        !Object.keys(changes).length || Object.keys(changes).some(key => !['level', 'quality', 'qualityId', 'enabled'].includes(key)) ||
        (changes.level !== undefined && (!Number.isInteger(changes.level) || changes.level < 1 || changes.level > 40)) ||
        (changes.quality !== undefined && (!Number.isInteger(changes.quality) || changes.quality < 0 || changes.quality > 99)) ||
        (changes.qualityId !== undefined && changes.qualityId !== 'Default') ||
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
      if (changes.quality !== undefined || changes.qualityId !== undefined) {
        const quality = changes.quality ?? target.quality;
        if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 0 || quality > 99) throw new Error('Existing gem quality is unavailable');
        await engine.setGemQuality({ groupIndex, gemIndex, quality, ...(changes.qualityId === undefined ? {} : { qualityId: changes.qualityId }) });
      }
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

  async deriveSupportReplacement(id: string, groupIndex: number, gemIndex: number, replacement: { gemName: string; level?: number; quality?: number }, trial = false): Promise<SnapshotRecord> {
    const validInt = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
    if (!validInt(groupIndex, 1, 10000) || !validInt(gemIndex, 1, 10000) || !replacement || typeof replacement !== 'object' || Array.isArray(replacement) || Object.keys(replacement).some(key => !['gemName', 'level', 'quality'].includes(key)) || typeof replacement.gemName !== 'string' || !replacement.gemName.trim() || replacement.gemName.length > 200 || (replacement.level !== undefined && !validInt(replacement.level, 1, 40)) || (replacement.quality !== undefined && !validInt(replacement.quality, 0, 99)) || Object.values(replacement).some(value => value === undefined)) throw new Error('Invalid support replacement');
    return this.derive(id, 'derived:support-replacement', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[] };
      const groups = (skills: unknown): Group[] => {
        const list = (skills as { groups?: Group[] })?.groups;
        if (!Array.isArray(list) || list.some((group, i) => group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const before = await read(), original = groups(before.skills), group = original.find(entry => entry.index === groupIndex);
      const target = group?.gems?.find(gem => gem.index === gemIndex);
      if (!group || !target || target.isSupport !== true) throw new Error('Requested gem is not a support in this group');
      if (target.enabled !== true || group.enabled !== true || group.slotEnabled !== true || (before.skills as Record<string, unknown>).mainSocketGroup !== groupIndex) throw new Error('Support replacement requires an enabled support in the active main group');
      const normalized = (name: unknown) => typeof name === 'string' ? name.trim().toLowerCase().replace(/ support$/, '') : '';
      if (group.gems!.some(gem => gem.index !== gemIndex && normalized(gem.name) === normalized(replacement.gemName))) throw new Error('Replacement already exists in the group');
      await engine.removeGem({ groupIndex, gemIndex });
      const added = await engine.addGem({ groupIndex, gemName: replacement.gemName.trim(), level: replacement.level ?? 20, quality: replacement.quality ?? 0, enabled: true, insertIndex: gemIndex });
      if (added.gemIndex !== gemIndex || typeof added.name !== 'string' || !added.name) throw new Error('PoB did not confirm the replacement gem');
      const after = await read(), updated = groups(after.skills), changed = updated.find(entry => entry.index === groupIndex)?.gems?.find(gem => gem.index === gemIndex);
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Support replacement modified unrelated ${section}`);
      for (const key of ['mainSocketGroup', 'calcsSkillNumber']) if ((before.skills as Record<string, unknown>)[key] !== (after.skills as Record<string, unknown>)[key]) throw new Error(`Support replacement modified unrelated ${key}`);
      if (!changed || changed.name !== added.name || changed.isSupport !== true || changed.enabled !== true || changed.level !== (replacement.level ?? 20) || changed.quality !== (replacement.quality ?? 0) || changed.qualityId !== 'Default' || changed.count !== 1 || changed.enableGlobal1 !== true || changed.enableGlobal2 !== false) throw new Error('PoB did not confirm the requested support properties');
      const canonical = (list: Group[]) => list.map(entry => ({ ...entry, ...(entry.index === groupIndex ? { skills: undefined, selectedSkillPart: undefined } : {}), gems: entry.gems!.filter(gem => !(entry.index === groupIndex && gem.index === gemIndex)).map(gem => { const copy = { ...gem }; delete copy.appliedToSelectedSkill; return copy; }) }));
      if (!isDeepStrictEqual(canonical(original), canonical(updated))) throw new Error('Support replacement modified unrelated skill or gem data');
    }, trial);
  }

  async deriveGemSetup(id: string, groupIndex: number, gems: Array<{ gemName: string; level?: number; quality?: number; enabled?: boolean }>, trial = false): Promise<SnapshotRecord> {
    const validInt = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
    const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/ support$/, '') : '';
    if (!validInt(groupIndex, 1, 10000) || !Array.isArray(gems) || gems.length < 1 || gems.length > 6 || gems.some(gem => !gem || typeof gem !== 'object' || Array.isArray(gem) || Object.keys(gem).some(key => !['gemName', 'level', 'quality', 'enabled'].includes(key)) || typeof gem.gemName !== 'string' || !gem.gemName.trim() || gem.gemName.length > 200 || (gem.level !== undefined && !validInt(gem.level, 1, 40)) || (gem.quality !== undefined && !validInt(gem.quality, 0, 99)) || (gem.enabled !== undefined && typeof gem.enabled !== 'boolean') || Object.values(gem).some(value => value === undefined)) || new Set(gems.map(gem => normalize(gem.gemName))).size !== gems.length) throw new Error('Invalid gem setup');
    const requested = new Map(gems.map(gem => [normalize(gem.gemName), gem]));
    return this.derive(id, 'derived:gem-setup', async engine => {
      const read = async () => normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), config: await engine.getConfig(), skills: await engine.getSkills() });
      type Gem = Record<string, unknown> & { index?: number };
      type Group = Record<string, unknown> & { index?: number; gems?: Gem[] };
      const groups = (skills: unknown): Group[] => {
        const list = (skills as { groups?: Group[] })?.groups;
        if (!Array.isArray(list) || list.some((group, i) => group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem, j) => gem.index !== j + 1))) throw new Error('PoB returned invalid skill groups');
        return list;
      };
      const before = await read(), original = groups(before.skills), group = original.find(entry => entry.index === groupIndex);
      if (!group || group.enabled !== true || group.slotEnabled !== true || (before.skills as Record<string, unknown>).mainSocketGroup !== groupIndex || !group.gems?.length || group.gems.some(gem => !normalize(gem.name)) || new Set(group.gems.map(gem => normalize(gem.name))).size !== group.gems.length) throw new Error('Gem setup requires an unambiguous active main group');
      const active = group.gems.filter(gem => gem.isSupport === false);
      if (active.length !== 1 || active[0].enabled !== true || !requested.has(normalize(active[0].name)) || requested.get(normalize(active[0].name))?.enabled === false) throw new Error('Gem setup must retain the enabled active gem');
      const originalNames = new Set(group.gems.map(gem => normalize(gem.name)));
      const removedPositions: number[] = [];
      for (let i = group.gems.length - 1; i >= 0; i--) if (!requested.has(normalize(group.gems[i].name))) { removedPositions.unshift(i + 1); await engine.removeGem({ groupIndex, gemIndex: i + 1 }); }
      let size = group.gems.length - removedPositions.length;
      const addedNames = new Map<string, string>();
      for (const candidate of gems) {
        const key = normalize(candidate.gemName);
        if (originalNames.has(key)) continue;
        const position = Math.min(removedPositions.shift() ?? size + 1, size + 1);
        const added = await engine.addGem({ groupIndex, gemName: candidate.gemName.trim(), level: candidate.level ?? 20, quality: candidate.quality ?? 0, enabled: candidate.enabled ?? true, insertIndex: position });
        if (added.gemIndex !== position || typeof added.name !== 'string' || normalize(added.name) !== key) throw new Error('PoB did not confirm the requested gem');
        addedNames.set(key, added.name); size++;
      }
      const interim = groups((await read()).skills).find(entry => entry.index === groupIndex);
      if (!interim?.gems) throw new Error('Skill group disappeared during gem setup');
      for (const gem of interim.gems) {
        const key = normalize(gem.name), candidate = requested.get(key);
        if (!candidate || !validInt(gem.index, 1, 10000)) throw new Error('PoB returned unexpected gem during setup');
        if (candidate.level !== undefined && gem.level !== candidate.level) await engine.setGemLevel({ groupIndex, gemIndex: gem.index!, level: candidate.level });
        if (candidate.quality !== undefined && gem.quality !== candidate.quality) await engine.setGemQuality({ groupIndex, gemIndex: gem.index!, quality: candidate.quality });
        if (candidate.enabled !== undefined && gem.enabled !== candidate.enabled) await engine.setGemEnabled({ groupIndex, gemIndex: gem.index!, enabled: candidate.enabled });
      }
      const after = await read(), updated = groups(after.skills), changed = updated.find(entry => entry.index === groupIndex);
      for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Gem setup modified unrelated ${section}`);
      for (const key of ['mainSocketGroup', 'calcsSkillNumber']) if ((before.skills as Record<string, unknown>)[key] !== (after.skills as Record<string, unknown>)[key]) throw new Error(`Gem setup modified unrelated ${key}`);
      if (!changed?.gems || changed.gems.length !== gems.length || new Set(changed.gems.map(gem => normalize(gem.name))).size !== gems.length || changed.mainActiveSkill !== group.mainActiveSkill || changed.selectedSkillPart !== group.selectedSkillPart || changed.gems.filter(gem => gem.isSupport === false).length !== 1 || changed.gems.some(gem => !requested.has(normalize(gem.name)))) throw new Error('PoB did not confirm the requested gem setup');
      for (const actual of changed.gems) {
        const key = normalize(actual.name), candidate = requested.get(key)!;
        if ((candidate.level !== undefined && actual.level !== candidate.level) || (candidate.quality !== undefined && actual.quality !== candidate.quality) || (candidate.enabled !== undefined && actual.enabled !== candidate.enabled)) throw new Error('PoB did not confirm the requested gem properties');
        if (addedNames.has(key) && (actual.name !== addedNames.get(key) || actual.isSupport !== true || actual.level !== (candidate.level ?? 20) || actual.quality !== (candidate.quality ?? 0) || actual.enabled !== (candidate.enabled ?? true) || actual.qualityId !== 'Default' || actual.count !== 1 || actual.enableGlobal1 !== true || actual.enableGlobal2 !== false)) throw new Error('PoB did not confirm new support properties');
      }
      const canonical = (list: Group[], retained: boolean) => list.map(entry => ({ ...entry, ...(entry.index === groupIndex ? { skills: undefined } : {}), gems: entry.gems!.filter(gem => entry.index !== groupIndex || (retained ? originalNames.has(normalize(gem.name)) : requested.has(normalize(gem.name)))).map(gem => {
        const copy = { ...gem }; delete copy.appliedToSelectedSkill;
        if (entry.index === groupIndex) { delete copy.index; const candidate = requested.get(normalize(gem.name)); for (const key of ['level', 'quality', 'enabled'] as const) if (candidate?.[key] !== undefined) delete copy[key]; }
        return copy;
      }) }));
      if (!isDeepStrictEqual(canonical(original, false), canonical(updated, true))) throw new Error('Gem setup modified unrelated skill or gem data');
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
    return this.deriveItemChanges(id, [{ slot, itemText }], trial, 'derived:item');
  }

  async deriveAutoItem(id: string, itemText: string, trial = false): Promise<{ snapshot: SnapshotRecord; slot: string; itemId: number }> {
    if (typeof itemText !== 'string' || !itemText.trim() || Buffer.byteLength(itemText, 'utf8') > 10240) throw new Error('Invalid item text');
    let slot = '', itemId = 0;
    let expectedInventory: Array<{ id: number; raw: string }> = [];
    let specCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    let itemCatalog: Awaited<ReturnType<BuildFoundation['readItemSetCatalog']>>;
    let specsBefore: Awaited<ReturnType<BuildFoundation['inspectSpecs']>>;
    let setsBefore: Awaited<ReturnType<BuildFoundation['inspectItemSets']>>;
    let specsAfter: typeof specsBefore, setsAfter: typeof setsBefore;
    const snapshot = await this.derive(id, 'derived:auto-item', async engine => {
      const inventory = await this.readItemInventory(engine);
      const before = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      if (!Array.isArray(before.items)) throw new Error('PoB returned invalid equipment');
      specCatalog = await this.readSpecCatalog(engine); itemCatalog = await this.readItemSetCatalog(engine);
      specsBefore = await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec);
      setsBefore = await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId);
      const added = await engine.addItem(itemText);
      if (!Number.isSafeInteger(added.id) || added.id < 1 || typeof added.slot !== 'string' || !added.slot.trim() || inventory.some(item => item.id === added.id)) throw new Error('PoB did not auto-equip the item into an empty slot');
      slot = added.slot; itemId = added.id;
      const after = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      if (!Array.isArray(after.items) || before.items.filter(item => item.slot === slot && item.id === 0).length !== 1 || after.items.filter(item => item.slot === slot && item.id === itemId).length !== 1 || !isDeepStrictEqual(before.items.filter(item => item.slot !== slot), after.items.filter(item => item.slot !== slot))) throw new Error('PoB changed equipment beyond the selected empty slot');
      for (const section of ['tree', 'skills', 'config'] as const) if (!isDeepStrictEqual(before[section], after[section])) throw new Error(`Auto-equipping changed unrelated ${section}`);
      expectedInventory = await this.readItemInventory(engine);
      if (expectedInventory.filter(item => item.id === itemId).length !== 1 || !isDeepStrictEqual(canonicalInventory(inventory), canonicalInventory(expectedInventory.filter(item => item.id !== itemId)))) throw new Error('PoB changed unrelated inventory items');
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), specCatalog) || !isDeepStrictEqual(await this.readItemSetCatalog(engine), itemCatalog)) throw new Error('Auto-equipping changed a spec or item-set catalog');
      specsAfter = await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec);
      setsAfter = await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId);
      const withoutSlot = (items: unknown) => Array.isArray(items) ? items.filter(item => item.slot !== slot) : items;
      const canonicalSpecs = (specs: typeof specsBefore) => specs.map(spec => ({ ...spec, items: withoutSlot(spec.items) }));
      const canonicalSets = (sets: typeof setsBefore) => sets.map(set => ({ ...set, items: set.id === itemCatalog.activeItemSetId ? withoutSlot(set.items) : set.items }));
      if (!isDeepStrictEqual(canonicalSpecs(specsBefore), canonicalSpecs(specsAfter))) throw new Error('Auto-equipping changed an unrelated passive spec or its equipment');
      for (let i = 0; i < specsBefore.length; i++) {
        const oldSlots = (specsBefore[i].items as Array<{ slot: string; id: number }>).filter(item => item.slot === slot);
        const newSlots = (specsAfter[i].items as Array<{ slot: string; id: number }>).filter(item => item.slot === slot);
        if (oldSlots.length > 1 || newSlots.length > 1 || oldSlots.length !== newSlots.length || (oldSlots.length === 1 && !isDeepStrictEqual(oldSlots[0], newSlots[0]) && !(oldSlots[0].id === 0 && newSlots[0].id === itemId))) throw new Error('Auto-equipping changed the selected slot unexpectedly in another passive spec');
      }
      if (!isDeepStrictEqual(canonicalSets(setsBefore), canonicalSets(setsAfter))) throw new Error('Auto-equipping changed an inactive equipment set');
    }, trial, async engine => {
      if (!isDeepStrictEqual(canonicalInventory(expectedInventory), canonicalInventory(await this.readItemInventory(engine)))) throw new Error('Auto-equipped inventory did not survive serialization');
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), specCatalog) || !isDeepStrictEqual(await this.readItemSetCatalog(engine), itemCatalog) || !isDeepStrictEqual(await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec), specsAfter) || !isDeepStrictEqual(await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId), setsAfter)) throw new Error('Auto-equipped item sets or passive specs did not survive serialization');
    });
    return { snapshot, slot, itemId };
  }

  private async readItemInventory(engine: BuildEngine) {
    if (!engine.getItemInventory) throw new Error('PoB adapter lacks item inventory inspection');
    const items = await engine.getItemInventory();
    if (!Array.isArray(items) || items.some(item => !item || !Number.isSafeInteger(item.id) || item.id < 1 || typeof item.raw !== 'string') || new Set(items.map(item => item.id)).size !== items.length) throw new Error('PoB returned invalid item inventory');
    return [...items].sort((a, b) => a.id - b.id);
  }

  async itemInventory(id: string, limit = 50, afterItemId = 0) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(afterItemId) || afterItemId < 0) throw new Error('Invalid inventory pagination');
    const { result, ...context } = await this.runReadOnlySnapshot(id, engine => this.readItemInventory(engine));
    const remaining = result.filter(item => item.id > afterItemId);
    const items = remaining.slice(0, limit);
    return { ...context, items, total: result.length, nextAfterItemId: remaining.length > items.length ? items[items.length - 1].id : null };
  }

  async deriveInventoryItem(id: string, itemText: string, trial = false): Promise<SnapshotRecord> {
    if (typeof itemText !== 'string' || !itemText.trim() || Buffer.byteLength(itemText, 'utf8') > 10240) throw new Error('Invalid item text');
    let expected: Array<{ id: number; raw: string }> = [];
    let specCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    let itemCatalog: Awaited<ReturnType<BuildFoundation['readItemSetCatalog']>>;
    let specsBefore: Awaited<ReturnType<BuildFoundation['inspectSpecs']>>;
    let setsBefore: Awaited<ReturnType<BuildFoundation['inspectItemSets']>>;
    const verifyOtherSets = async (engine: BuildEngine) => {
      const specs = await this.readSpecCatalog(engine), sets = await this.readItemSetCatalog(engine);
      if (!isDeepStrictEqual(specs, specCatalog) || !isDeepStrictEqual(sets, itemCatalog)) throw new Error('Adding an inventory item changed a spec or item-set catalog');
      if (!isDeepStrictEqual(await this.inspectSpecs(engine, specs, specs.activeSpec), specsBefore)) throw new Error('Adding an inventory item changed a passive spec or its equipment');
      if (!isDeepStrictEqual(await this.inspectItemSets(engine, sets, sets.activeItemSetId), setsBefore)) throw new Error('Adding an inventory item changed an equipment set');
    };
    return this.derive(id, 'derived:inventory-item', async engine => {
      const inventory = await this.readItemInventory(engine);
      const before = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      specCatalog = await this.readSpecCatalog(engine); itemCatalog = await this.readItemSetCatalog(engine);
      specsBefore = await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec);
      setsBefore = await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId);
      const added = await engine.addItem(itemText, undefined, true);
      expected = await this.readItemInventory(engine);
      if (!Number.isSafeInteger(added.id) || added.id < 1 || added.slot != null || inventory.some(item => item.id === added.id) || expected.filter(item => item.id === added.id).length !== 1 || !isDeepStrictEqual(canonicalInventory(inventory), canonicalInventory(expected.filter(item => item.id !== added.id)))) throw new Error('PoB did not add exactly one unequipped item');
      const after = normalizeObservation({ tree: await engine.getTree(), items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      if (!isDeepStrictEqual(before, after)) throw new Error('Adding an inventory item changed the build');
      await verifyOtherSets(engine);
    }, trial, async engine => {
      if (!isDeepStrictEqual(canonicalInventory(expected), canonicalInventory(await this.readItemInventory(engine)))) throw new Error('Item inventory did not survive serialization');
      await verifyOtherSets(engine);
    });
  }

  async deriveItems(id: string, items: Array<{ slot: string; itemText: string }>, trial = false): Promise<SnapshotRecord> {
    return this.deriveItemChanges(id, items, trial, 'derived:items');
  }

  private async deriveItemChanges(id: string, items: Array<{ slot: string; itemText: string }>, trial: boolean, source: string): Promise<SnapshotRecord> {
    if (!Array.isArray(items) || items.length < 1 || items.length > 10 || items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['slot', 'itemText'].includes(key)) || typeof item.slot !== 'string' || !item.slot.trim() || item.slot !== item.slot.trim() || item.slot.length > 100 || typeof item.itemText !== 'string' || !item.itemText.trim() || Buffer.byteLength(item.itemText, 'utf8') > 10240) || new Set(items.map(item => item.slot)).size !== items.length) throw new Error('Invalid items or duplicate slots');
    let specCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    let itemCatalog: Awaited<ReturnType<BuildFoundation['readItemSetCatalog']>>;
    let specsAfter: Awaited<ReturnType<BuildFoundation['inspectSpecs']>>;
    let setsAfter: Awaited<ReturnType<BuildFoundation['inspectItemSets']>>;
    return this.derive(id, source, async engine => {
      specCatalog = await this.readSpecCatalog(engine); itemCatalog = await this.readItemSetCatalog(engine);
      const specsBefore = await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec);
      const setsBefore = await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId);
      const changedSlots = new Map<string, number>();
      for (const { slot, itemText } of items) {
        const socket = /^Jewel (\d+)$/.exec(slot);
        const beforeTree = socket ? normalizeObservation({ tree: await engine.getTree() }).tree as { nodes?: unknown } | undefined : undefined;
        if (socket && (!beforeTree || !Array.isArray(beforeTree.nodes) || !beforeTree.nodes.includes(Number(socket[1])))) throw new Error('Requested jewel socket is not allocated');
        const before = normalizeObservation({ items: await engine.getItems() }).items;
        if (!Array.isArray(before) || before.filter(item => item.slot === slot).length !== 1) throw new Error('Requested item slot is unavailable');
        const added = await engine.addItem(itemText, slot);
        const after = normalizeObservation({ items: await engine.getItems() }).items;
        if (!Array.isArray(after) || added.slot !== slot || !Number.isSafeInteger(added.id) || added.id < 1 || after.filter(item => item.slot === slot && item.id === added.id).length !== 1) throw new Error('PoB did not equip the item in the requested slot');
        changedSlots.set(slot, added.id);
        if (!isDeepStrictEqual(before.filter(item => item.slot !== slot), after.filter(item => item.slot !== slot))) throw new Error('Equipping the item changed other slots');
        if (socket && !isDeepStrictEqual(beforeTree, normalizeObservation({ tree: await engine.getTree() }).tree)) throw new Error('Equipping the jewel changed the passive tree');
      }
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), specCatalog) || !isDeepStrictEqual(await this.readItemSetCatalog(engine), itemCatalog)) throw new Error('Equipping changed a spec or item-set catalog');
      specsAfter = await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec);
      setsAfter = await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId);
      const otherSlots = (rows: unknown) => Array.isArray(rows) ? rows.filter(row => !changedSlots.has(row.slot)) : rows;
      if (!isDeepStrictEqual(specsBefore.map(spec => ({ ...spec, items: otherSlots(spec.items) })), specsAfter.map(spec => ({ ...spec, items: otherSlots(spec.items) })))) throw new Error('Equipping changed an unrelated passive spec or its equipment');
      for (let i = 0; i < specsBefore.length; i++) for (const [slot, itemId] of changedSlots) {
        const before = (specsBefore[i].items as Array<{ slot: string; id: number }>).filter(row => row.slot === slot);
        const after = (specsAfter[i].items as Array<{ slot: string; id: number }>).filter(row => row.slot === slot);
        if (before.length > 1 || after.length > 1 || before.length !== after.length || (before.length === 1 && !isDeepStrictEqual(before[0], after[0]) && after[0].id !== itemId)) throw new Error('Equipping changed a requested slot unexpectedly in another passive spec');
      }
      const canonicalSets = (sets: typeof setsBefore) => sets.map(set => ({ ...set, items: set.id === itemCatalog.activeItemSetId ? otherSlots(set.items) : set.items }));
      if (!isDeepStrictEqual(canonicalSets(setsBefore), canonicalSets(setsAfter))) throw new Error('Equipping changed an inactive equipment set');
    }, trial, async engine => {
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), specCatalog) || !isDeepStrictEqual(await this.readItemSetCatalog(engine), itemCatalog) || !isDeepStrictEqual(await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec), specsAfter) || !isDeepStrictEqual(await this.inspectItemSets(engine, itemCatalog, itemCatalog.activeItemSetId), setsAfter)) throw new Error('Equipped item sets or passive specs did not survive serialization');
    });
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

  private async inspectItemSets(engine: BuildEngine, catalog: Awaited<ReturnType<BuildFoundation['readItemSetCatalog']>>, restoreId: number) {
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

  async deriveTreeReplacement(id: string, target: { classId: number; ascendClassId: number; secondaryAscendClassId: number; nodes: number[]; masteryEffects: Record<string, number>; treeVersion: string }, trial = false, overridePolicy: 'reject' | 'preserve' = 'reject'): Promise<SnapshotRecord> {
    if (!['reject', 'preserve'].includes(overridePolicy)) throw new Error('Invalid node override policy');
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['classId', 'ascendClassId', 'secondaryAscendClassId', 'nodes', 'masteryEffects', 'treeVersion'].includes(key)) ||
        [target.classId, target.ascendClassId, target.secondaryAscendClassId].some(value => !Number.isSafeInteger(value) || value < 0 || value > 255) || typeof target.treeVersion !== 'string' || !/^\d+_\d+[A-Za-z0-9_]*$/.test(target.treeVersion) || target.treeVersion.length > 60 ||
        !Array.isArray(target.nodes) || target.nodes.length > 2000 || target.nodes.some(node => !Number.isSafeInteger(node) || node < 1 || node > 2147483647) || new Set(target.nodes).size !== target.nodes.length ||
        !target.masteryEffects || typeof target.masteryEffects !== 'object' || Array.isArray(target.masteryEffects) || Object.entries(target.masteryEffects).some(([node, effect]) => !/^[1-9][0-9]*$/.test(node) || !target.nodes.includes(Number(node)) || !Number.isSafeInteger(effect) || effect < 1 || effect > 2147483647)) throw new Error('Invalid complete tree replacement');
    let expectedSpecs: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let expectedCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    let expectedOverrides: unknown;
    return this.derive(id, 'derived:tree-replacement', async engine => {
      const beforeCatalog = await this.readSpecCatalog(engine);
      const beforeSpecs = await this.inspectSpecs(engine, beforeCatalog, beforeCatalog.activeSpec);
      const before = normalizeObservation({ items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      if (overridePolicy === 'preserve') {
        if (!engine.getTreeOverrides) throw new Error('PoB adapter lacks node override inspection');
        expectedOverrides = await engine.getTreeOverrides();
        if (!Array.isArray(expectedOverrides)) throw new Error('PoB returned invalid node overrides');
      }
      await engine.setTree(target, overridePolicy === 'preserve');
      if (overridePolicy === 'preserve' && !isDeepStrictEqual(expectedOverrides, await engine.getTreeOverrides!())) throw new Error('PoB changed node overrides during tree replacement');
      const tree = await engine.getTree() as { classId?: unknown; ascendClassId?: unknown; secondaryAscendClassId?: unknown; treeVersion?: unknown; nodes?: unknown; masteryEffects?: unknown };
      const mastery = Array.isArray(tree?.masteryEffects) && tree.masteryEffects.length === 0 ? {} : tree?.masteryEffects;
      if (!tree || tree.classId !== target.classId || tree.ascendClassId !== target.ascendClassId || tree.secondaryAscendClassId !== target.secondaryAscendClassId || tree.treeVersion !== target.treeVersion || !Array.isArray(tree.nodes) || tree.nodes.length !== target.nodes.length || new Set(tree.nodes).size !== target.nodes.length || tree.nodes.some(node => !target.nodes.includes(node)) || !isDeepStrictEqual(mastery, target.masteryEffects)) throw new Error('PoB did not apply the complete requested tree');
      for (const [node, effect] of Object.entries(target.masteryEffects)) {
        const options = await engine.getMasteryNodeOptions(Number(node));
        if (!options || options.nodeId !== Number(node) || !options.allocated || options.allocatedEffect !== effect || !options.availableEffects?.some(entry => entry.effectId === effect)) throw new Error(`PoB did not validate mastery effect: ${node}=${effect}`);
      }
      await engine.refreshTreeProgress();
      if (!isDeepStrictEqual(await engine.getTree(), tree)) throw new Error('PoB changed the requested tree while refreshing progress');
      const after = normalizeObservation({ items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() });
      if (!isDeepStrictEqual(before, after)) throw new Error('Tree replacement changed equipment, skills or configuration');
      expectedCatalog = await this.readSpecCatalog(engine);
      if (expectedCatalog.activeSpec !== beforeCatalog.activeSpec || expectedCatalog.specs.length !== beforeCatalog.specs.length) throw new Error('Tree replacement changed passive spec selection or count');
      expectedSpecs = await this.inspectSpecs(engine, expectedCatalog, expectedCatalog.activeSpec);
      if (beforeSpecs.some((spec, index) => spec.index !== beforeCatalog.activeSpec && !isDeepStrictEqual(spec, expectedSpecs[index]))) throw new Error('Tree replacement changed an inactive passive spec');
    }, trial, async engine => {
      const catalog = await this.readSpecCatalog(engine);
      if (!isDeepStrictEqual(catalog, expectedCatalog) || !isDeepStrictEqual(await this.inspectSpecs(engine, catalog, catalog.activeSpec), expectedSpecs)) throw new Error('Replaced tree or inactive specs did not survive serialization');
      if (overridePolicy === 'preserve' && !isDeepStrictEqual(expectedOverrides, await engine.getTreeOverrides!())) throw new Error('Node overrides did not survive serialization');
    });
  }

  async trialTreeRemoval(id: string, nodeId: number): Promise<{ snapshot: SnapshotRecord; removed: Array<{ id: number; name: string | null }> }> {
    if (!Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > 2147483647) throw new Error('Invalid removal node ID');
    let removed: Array<{ id: number; name: string | null }> = [];
    let inactiveSpecs: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let updatedCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    type Tree = { nodes?: number[]; treeVersion?: string; classId?: number; ascendClassId?: number; secondaryAscendClassId?: number; masteryEffects?: unknown };
    const validateTree = (value: unknown): Tree & { nodes: number[]; mastery: Record<string, unknown> } => {
      const tree = value as Tree;
      if (!tree || typeof tree !== 'object' || Array.isArray(tree) || typeof tree.treeVersion !== 'string' || !tree.treeVersion || !Array.isArray(tree.nodes) || tree.nodes.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(tree.nodes).size !== tree.nodes.length) throw new Error('PoB returned invalid tree state');
      const mastery = tree.masteryEffects;
      if (!mastery || typeof mastery !== 'object' || (Array.isArray(mastery) && mastery.length > 0)) throw new Error('PoB returned an invalid mastery map');
      return { ...tree, nodes: tree.nodes, mastery: Array.isArray(mastery) ? {} : { ...mastery } };
    };
    const snapshot = await this.derive(id, 'trial:tree-removal', async engine => {
      if (!engine.deallocateTreeNode) throw new Error('PoB adapter lacks native tree deallocation');
      const catalog = await this.readSpecCatalog(engine);
      inactiveSpecs = (await this.inspectSpecs(engine, catalog, catalog.activeSpec)).filter(spec => spec.index !== catalog.activeSpec);
      const before = validateTree(await engine.getTree());
      if (!before.nodes.includes(nodeId)) throw new Error('Requested node is not allocated');
      const labels = await engine.queryTreePaths({ allocatedOnly: true }) as { mode?: unknown; treeVersion?: unknown; nodes?: Array<{ id?: unknown; name?: unknown; nameKnown?: unknown }> };
      if (!labels || labels.mode !== 'allocated' || labels.treeVersion !== before.treeVersion || !Array.isArray(labels.nodes) || labels.nodes.some(n => !n || !Number.isSafeInteger(n.id) || typeof n.name !== 'string' || typeof n.nameKnown !== 'boolean') || new Set(labels.nodes.map(n => n.id)).size !== labels.nodes.length || labels.nodes.some(n => !before.nodes.includes(n.id as number))) throw new Error('PoB returned invalid allocated node details');
      const result = await engine.deallocateTreeNode(nodeId);
      const after = validateTree(await engine.getTree());
      const beforeSet = new Set(before.nodes), afterSet = new Set(after.nodes);
      const actual = before.nodes.filter(node => !afterSet.has(node)).sort((a, b) => a - b);
      if (!Array.isArray(result.expectedRemoved) || result.expectedRemoved.some(n => !Number.isSafeInteger(n) || n < 1) || !isDeepStrictEqual([...result.expectedRemoved].sort((a, b) => a - b), actual) || !actual.includes(nodeId) || after.nodes.some(node => !beforeSet.has(node)) || before.treeVersion !== after.treeVersion || before.classId !== after.classId || before.ascendClassId !== after.ascendClassId || before.secondaryAscendClassId !== after.secondaryAscendClassId) throw new Error('PoB deallocation did not match its declared dependencies');
      const expectedMasteries = { ...before.mastery };
      for (const node of actual) delete expectedMasteries[String(node)];
      if (!isDeepStrictEqual(expectedMasteries, after.mastery)) throw new Error('PoB deallocation changed unrelated mastery selections');
      removed = actual.map(id => { const entry = labels.nodes!.find(node => node.id === id); return { id, name: entry?.nameKnown === true ? entry.name as string : null }; });
      await engine.refreshTreeProgress();
      if (!isDeepStrictEqual(validateTree(await engine.getTree()), after)) throw new Error('Tree progress refresh changed the removal result');
      updatedCatalog = await this.readSpecCatalog(engine);
      const withoutActiveCount = (value: typeof catalog) => ({ ...value, specs: value.specs.map(spec => spec.active ? { ...spec, nodeCount: undefined } : spec) });
      if (updatedCatalog.specs[updatedCatalog.activeSpec - 1].nodeCount !== after.nodes.length || !isDeepStrictEqual(withoutActiveCount(updatedCatalog), withoutActiveCount(catalog)) || !isDeepStrictEqual((await this.inspectSpecs(engine, updatedCatalog, updatedCatalog.activeSpec)).filter(spec => spec.index !== updatedCatalog.activeSpec), inactiveSpecs)) throw new Error('Tree removal changed a passive spec catalog or an inactive passive spec');
    }, true, async engine => {
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), updatedCatalog) || !isDeepStrictEqual((await this.inspectSpecs(engine, updatedCatalog, updatedCatalog.activeSpec)).filter(spec => spec.index !== updatedCatalog.activeSpec), inactiveSpecs)) throw new Error('Inactive passive specs did not survive tree removal serialization');
    });
    return { snapshot, removed };
  }

  async deriveTreePaths(id: string, targets: number[], masteryEffects: Record<string, number> = {}, trial = false): Promise<{ snapshot: SnapshotRecord; paths: Array<{ targetNodeId: number; status: string; pathNodes: number[] }> }> {
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 5 || targets.some(node => !Number.isSafeInteger(node) || node < 1 || node > 2147483647) || new Set(targets).size !== targets.length || !masteryEffects || typeof masteryEffects !== 'object' || Array.isArray(masteryEffects) || Object.entries(masteryEffects).some(([node, effect]) => !/^[1-9][0-9]*$/.test(node) || !targets.includes(Number(node)) || !Number.isSafeInteger(effect) || effect < 1)) throw new Error('Invalid tree path targets or mastery effects');
    const paths: Array<{ targetNodeId: number; status: string; pathNodes: number[] }> = [];
    let inactiveSpecs: Awaited<ReturnType<BuildFoundation['inspectSpecs']>> = [];
    let specCatalog: Awaited<ReturnType<BuildFoundation['readSpecCatalog']>>;
    let updatedCatalog: typeof specCatalog;
    const treeState = async (engine: BuildEngine) => {
      const tree = await engine.getTree() as { nodes?: unknown; treeVersion?: unknown; classId?: unknown; ascendClassId?: unknown; secondaryAscendClassId?: unknown; masteryEffects?: unknown };
      if (!tree || !Array.isArray(tree.nodes) || tree.nodes.some(node => !Number.isSafeInteger(node) || node < 1) || new Set(tree.nodes).size !== tree.nodes.length || typeof tree.treeVersion !== 'string' || !tree.treeVersion) throw new Error('PoB returned invalid tree state');
      const value = tree.masteryEffects;
      if (!value || typeof value !== 'object' || (Array.isArray(value) && value.length > 0)) throw new Error('PoB returned an invalid mastery map');
      return { ...tree, nodes: tree.nodes as number[], masteryEffects: Array.isArray(value) ? {} : { ...value } as Record<string, number> };
    };
    const snapshot = await this.derive(id, 'derived:tree-paths', async engine => {
      specCatalog = await this.readSpecCatalog(engine);
      inactiveSpecs = (await this.inspectSpecs(engine, specCatalog, specCatalog.activeSpec)).filter(spec => spec.index !== specCatalog.activeSpec);
      let current = await treeState(engine), totalAdded = 0;
      for (const target of targets) {
        const result = await engine.queryTreePaths({ targetNodeId: target }) as { treeVersion?: unknown; mode?: unknown; targetNodeId?: unknown; status?: unknown; node?: { id?: unknown; status?: unknown; allocated?: unknown; pointCost?: unknown; pathNodes?: unknown; type?: unknown; isBlighted?: unknown } };
        if (!result || result.mode !== 'target' || result.treeVersion !== current.treeVersion || result.targetNodeId !== target || result.status !== 'found' || !result.node || result.node.id !== target) throw new Error(`PoB did not find target node ${target} on the current tree`);
        const node = result.node;
        if (node.status === 'allocated' && node.allocated === true && node.pointCost === 0 && Array.isArray(node.pathNodes) && node.pathNodes.length === 0) {
          if (masteryEffects[String(target)] !== undefined) throw new Error(`Cannot set an effect on an already allocated target: ${target}`);
          paths.push({ targetNodeId: target, status: 'already_allocated', pathNodes: [] }); continue;
        }
        const path = node.pathNodes;
        if (node.status !== 'reachable' || node.allocated !== false || node.isBlighted !== false || !Array.isArray(path) || path.length === 0 || path.length > 200 || path.some(n => !Number.isSafeInteger(n) || n < 1 || n > 2147483647 || current.nodes.includes(n)) || new Set(path).size !== path.length || path[path.length - 1] !== target || node.pointCost !== path.length) throw new Error(`Target node ${target} has no valid allocatable path`);
        totalAdded += path.length; if (totalAdded > 200) throw new Error('Combined tree path exceeds 200 nodes');
        const effect = masteryEffects[String(target)];
        if (node.type === 'mastery') {
          if (effect === undefined) throw new Error(`Mastery target ${target} requires an effect`);
          const options = await engine.getMasteryNodeOptions(target);
          if (!options || options.nodeId !== target || options.allocated || !Array.isArray(options.availableEffects) || !options.availableEffects.some(entry => entry.effectId === effect)) throw new Error(`Invalid new mastery effect: ${target}=${effect}`);
        } else if (effect !== undefined) throw new Error(`Effect provided for non-mastery target: ${target}`);
        const applied = await engine.updateTreeDelta({ addNodes: path, removeNodes: [], ...(effect === undefined ? {} : { masteryEffects: { [String(target)]: effect } }) });
        const after = await treeState(engine), expectedNodes = new Set([...current.nodes, ...path]);
        const expectedMasteries = { ...current.masteryEffects, ...(effect === undefined ? {} : { [String(target)]: effect }) };
        if ((applied.droppedNodes?.length ?? 0) > 0 || after.nodes.length !== expectedNodes.size || after.nodes.some(n => !expectedNodes.has(n)) || after.treeVersion !== current.treeVersion || after.classId !== current.classId || after.ascendClassId !== current.ascendClassId || after.secondaryAscendClassId !== current.secondaryAscendClassId || !isDeepStrictEqual(after.masteryEffects, expectedMasteries)) throw new Error(`PoB did not apply exactly the path to ${target}`);
        paths.push({ targetNodeId: target, status: 'allocated', pathNodes: path }); current = after;
      }
      if (!totalAdded) throw new Error('All target nodes are already allocated');
      await engine.refreshTreeProgress();
      if (!isDeepStrictEqual(await treeState(engine), current)) throw new Error('Tree progress refresh changed the allocated paths');
      updatedCatalog = await this.readSpecCatalog(engine);
      const withoutActiveCount = (catalog: typeof specCatalog) => ({ ...catalog, specs: catalog.specs.map(spec => spec.active ? { ...spec, nodeCount: undefined } : spec) });
      if (updatedCatalog.specs[updatedCatalog.activeSpec - 1].nodeCount !== current.nodes.length || !isDeepStrictEqual(withoutActiveCount(updatedCatalog), withoutActiveCount(specCatalog)) || !isDeepStrictEqual((await this.inspectSpecs(engine, updatedCatalog, updatedCatalog.activeSpec)).filter(spec => spec.index !== updatedCatalog.activeSpec), inactiveSpecs)) throw new Error('Allocating paths changed the active node count, passive spec catalog or an inactive passive spec');
    }, trial, async engine => {
      if (!isDeepStrictEqual(await this.readSpecCatalog(engine), updatedCatalog) || !isDeepStrictEqual((await this.inspectSpecs(engine, updatedCatalog, updatedCatalog.activeSpec)).filter(spec => spec.index !== updatedCatalog.activeSpec), inactiveSpecs)) throw new Error('Inactive passive specs did not survive path serialization');
    });
    return { snapshot, paths };
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

  /** Apply every preset value exactly; unchanged legacy keys need not be writable. */
  async deriveExactConfig(id: string, config: Record<string, string | number | boolean>, trial = false, enemyLevelSetting?: EnemyLevelSetting): Promise<{ snapshot: SnapshotRecord; changedKeys: string[] }> {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config');
    validateEvaluationOptions({ config });
    if (enemyLevelSetting !== undefined && (!validEnemyLevelSetting(enemyLevelSetting) || !Object.hasOwn(config, 'enemyLevel'))) throw new Error('Invalid enemy level setting');
    const expected = Object.fromEntries(Object.entries(config).filter(([key]) => !enemyLevelSetting || key !== 'enemyLevel'));
    const specified = (key: string) => Object.hasOwn(expected, key) || !!enemyLevelSetting && key === 'enemyLevel';
    let changedKeys: string[] = [], unrelated: Record<string, unknown> = {};
    const verify = async (engine: BuildEngine) => {
      const actual = await engine.getConfig();
      if (!actual || typeof actual !== 'object' || Array.isArray(actual) && actual.length !== 0) throw new Error('PoB returned invalid config');
      const record = actual as Record<string, unknown>;
      if (Object.entries(expected).some(([key, value]) => !Object.hasOwn(record, key) || !isDeepStrictEqual(record[key], value))) throw new Error('PoB did not preserve every preset value');
      if (enemyLevelSetting && !isDeepStrictEqual(await engine.getEnemyLevelSetting(), enemyLevelSetting)) throw new Error('PoB did not preserve the enemy level setting; PoB may omit an explicit level equal to its default on save');
      const actualUnrelated = Object.fromEntries(Object.entries(record).filter(([key]) => !specified(key)));
      if (!isDeepStrictEqual(unrelated, actualUnrelated)) throw new Error('Preset changed an unrelated configuration value');
    };
    const snapshot = await this.derive(id, 'derived:config-preset', async engine => {
      const before = await engine.getConfig();
      if (!before || typeof before !== 'object' || Array.isArray(before) && before.length !== 0) throw new Error('PoB returned invalid config');
      const record = before as Record<string, unknown>;
      changedKeys = Object.keys(expected).filter(key => !Object.hasOwn(record, key) || !isDeepStrictEqual(record[key], expected[key]));
      const currentLevelSetting = enemyLevelSetting ? await engine.getEnemyLevelSetting() : undefined;
      if (enemyLevelSetting && !isDeepStrictEqual(currentLevelSetting, enemyLevelSetting)) changedKeys.push('enemyLevel');
      unrelated = Object.fromEntries(Object.entries(record).filter(([key]) => !specified(key)));
      if (changedKeys.length) {
        const changes = Object.fromEntries(changedKeys.map(key => [key, enemyLevelSetting && key === 'enemyLevel' ? enemyLevelSetting.mode === 'automatic' ? 0 : enemyLevelSetting.value : expected[key]]));
        const result = await engine.setConfig(changes);
        if (!result || !result.rejected || Object.keys(result.rejected).length) throw new Error(`PoB rejected preset config: ${JSON.stringify(result?.rejected ?? {})}`);
        if (!result.applied || changedKeys.some(key => !Object.hasOwn(result.applied!, key))) throw new Error('PoB did not apply every changed preset value');
      }
      await verify(engine);
    }, trial, verify);
    return { snapshot, changedKeys };
  }

  async notes(id: string) {
    const { result, ...context } = await this.runReadOnlySnapshot(id, engine => engine.getBuildNotes());
    if (typeof result !== 'string') throw new Error('PoB returned invalid notes');
    return { ...context, notes: result };
  }

  async deriveNotes(id: string, notes: string, trial = false, mode: 'replace' | 'append' = 'replace'): Promise<SnapshotRecord> {
    const validNotes = (value: unknown): value is string => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 512 * 1024 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
    if (!validNotes(notes) || !['replace', 'append'].includes(mode)) throw new Error('Notes must be valid XML text of at most 512 KiB and mode must be replace or append');
    let expected: string | undefined;
    const verify = async (engine: BuildEngine) => {
      if (expected === undefined || await engine.getBuildNotes() !== expected) throw new Error('PoB did not preserve the requested notes');
    };
    return this.derive(id, 'derived:notes', async engine => {
      const before = await observe(engine);
      const previous = await engine.getBuildNotes();
      if (typeof previous !== 'string') throw new Error('PoB returned invalid notes');
      expected = mode === 'append' ? previous + (notes && previous ? '\n\n---\n\n' : '') + notes : notes;
      if (!validNotes(expected)) throw new Error('Combined notes must be valid XML text of at most 512 KiB');
      await engine.setBuildNotes(expected);
      await verify(engine);
      if (!isDeepStrictEqual(before, await observe(engine))) throw new Error('Notes change modified unrelated build state');
    }, trial, verify);
  }

  async readSnapshot(id: string) { return snapshotMetadata(await this.store.read(id)); }
  async retainSnapshot(id: string) { return this.store.retain(id); }
  async snapshotRetention(id: string) { return this.store.retentionStatus(id); }
  async listSnapshots(limit?: number, after?: string) { return this.store.list(limit, after); }
  async saveHistory(id: string, input: SnapshotHistoryInput) { return this.store.saveHistory(id, input); }
  async listHistory() { return this.store.listHistory(); }
  async exportBuild(id: string): Promise<string> { return (await this.store.read(id)).xml; }
}
