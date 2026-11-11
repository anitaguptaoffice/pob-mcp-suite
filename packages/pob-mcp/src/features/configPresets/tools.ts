import { createHash } from 'node:crypto';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import type { ConfigPresetStore } from '../../ports/configPresets.js';
import { validPresetName, validatePresetConfig, validEnemyLevelSetting } from '../../domain/configPreset.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
const validId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function configPresetSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'list_local_config_presets', description: 'List saved local PoB MCP configuration presets with collision-safe pagination.', inputSchema: { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, catalog_fingerprint: { type: 'string' } } } },
    { name: 'read_local_config_preset', description: 'Read a saved configuration preset without changing a build.', inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'save_snapshot_config_preset', description: 'Save all current snapshot config values to a local preset.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, name: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['snapshot_id', 'name'] } },
    { name: 'apply_snapshot_config_preset', description: 'Apply saved settings in a derived snapshot, preserving automatic enemy level where recorded. Unchanged historical keys are retained; rejected or changed unrelated settings prevent publication.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, name: { type: 'string' }, trial: { type: 'boolean' } }, required: ['snapshot_id', 'name'] } },
  ];
}
export function createConfigPresetCatalogTools(store: ConfigPresetStore): FeatureTool[] {
  const [list, read] = configPresetSchemas();
  return [
    { schema: list, invoke: async args => {
      const offset = args.offset ?? 0, limit = args.limit ?? 50;
      if (Object.keys(args).some(key => !['offset', 'limit', 'catalog_fingerprint'].includes(key)) || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (args.catalog_fingerprint !== undefined && (typeof args.catalog_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.catalog_fingerprint))) || (offset > 0 && args.catalog_fingerprint === undefined)) throw new Error('Invalid preset catalog options');
      const all = await store.list(), fingerprint = createHash('sha256').update(JSON.stringify(all)).digest('hex');
      if (args.catalog_fingerprint !== undefined && args.catalog_fingerprint !== fingerprint) throw new Error('Preset catalog changed; restart pagination');
      const presets = all.slice(offset, offset + limit);
      return json({ presets, total: all.length, offset, catalogFingerprint: fingerprint, nextOffset: offset + presets.length < all.length ? offset + presets.length : null, warnings: ['Presets are local files under the build directory; listing them does not change a build.'] });
    } },
    { schema: read, invoke: async args => {
      if (Object.keys(args).some(key => !['name'].includes(key)) || !validPresetName(args.name)) throw new Error('Invalid preset read options');
      const preset = await store.read(args.name);
      return json({ preset, warnings: ['Reading a preset does not change a build.'] });
    } },
  ];
}
export function createSnapshotConfigPresetTools(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveExactConfig'>, store: ConfigPresetStore): FeatureTool[] {
  const [, , save, apply] = configPresetSchemas();
  return [
    { schema: save, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'name', 'overwrite'].includes(key)) || !validId(args.snapshot_id) || !validPresetName(args.name) || (args.overwrite !== undefined && typeof args.overwrite !== 'boolean')) throw new Error('Invalid preset save options');
      const observation = await foundation.runReadOnlySnapshot(args.snapshot_id as string, async engine => ({ config: await engine.getConfig(), enemyLevelSetting: await engine.getEnemyLevelSetting() }));
      const config = Array.isArray(observation.result.config) && observation.result.config.length === 0 ? {} : observation.result.config;
      validatePresetConfig(config);
      if (!validEnemyLevelSetting(observation.result.enemyLevelSetting) || typeof config.enemyLevel !== 'number' || !Number.isFinite(config.enemyLevel)) throw new Error('PoB did not provide a valid enemy level setting');
      const identity = Object.fromEntries(identityKeys.map(key => [key, observation.identity[key] ?? null]));
      const preset = { name: args.name, config, enemyLevelSetting: observation.result.enemyLevelSetting, sourceSnapshotId: observation.snapshotId, sourceIdentity: identity, savedAt: new Date().toISOString() };
      await store.save(preset, args.overwrite === true);
      return json({ name: preset.name, sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt, enemyLevelSetting: preset.enemyLevelSetting, keyCount: Object.keys(config).length, warnings: [...observation.warnings, 'Applying this preset requires a separate snapshot operation.'] });
    } },
    { schema: apply, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'name', 'trial'].includes(key)) || !validId(args.snapshot_id) || !validPresetName(args.name) || (args.trial !== undefined && typeof args.trial !== 'boolean')) throw new Error('Invalid preset apply options');
      const preset = await store.read(args.name);
      const result = await foundation.deriveExactConfig(args.snapshot_id as string, preset.config, args.trial === true, preset.enemyLevelSetting);
      const mismatched = identityKeys.filter(key => preset.sourceIdentity[key] && result.snapshot[key] && preset.sourceIdentity[key] !== result.snapshot[key]);
      const unknown = identityKeys.filter(key => !preset.sourceIdentity[key] || !result.snapshot[key]);
      return json({ preset: { name: preset.name, sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt, enemyLevelSetting: preset.enemyLevelSetting }, snapshot: snapshotMetadata(result.snapshot), changedKeys: result.changedKeys, identityDifferences: mismatched, identityUnknown: unknown,
        warnings: ['Saved settings were checked after application and reload. Target settings absent from the preset were preserved.', 'Preset files and the parent snapshot were not changed.', ...(preset.enemyLevelSetting.mode === 'automatic' ? ['Enemy level remains automatic and can differ from the source build’s effective value.'] : []), ...(mismatched.length ? ['Preset source and target PoB identities differ; exact application does not establish equivalent game mechanics.'] : []), ...(unknown.length ? ['Some source or target PoB identities are unknown.'] : [])] });
    } },
  ];
}
