import { createHash } from 'node:crypto';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import type { ConfigPresetStore, PresetOrigin } from '../../ports/configPresets.js';
import { validPresetName, validatePresetConfig } from '../../domain/configPreset.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
const validId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validOrigin = (value: unknown) => value === undefined || value === 'versioned' || value === 'legacy';
export function configPresetSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'list_local_config_presets', description: 'List versioned and legacy local PoB MCP configuration presets, with explicit origins and collision-safe pagination.', inputSchema: { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, catalog_fingerprint: { type: 'string' } } } },
    { name: 'read_local_config_preset', description: 'Read a configuration preset without changing a build. Specify origin when names exist in both stores.', inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, origin: { type: 'string', enum: ['versioned', 'legacy'] } }, required: ['name'] } },
    { name: 'save_snapshot_config_preset', description: 'Save all current snapshot config values to a versioned local preset; legacy preset files are never modified.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, name: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['snapshot_id', 'name'] } },
    { name: 'apply_snapshot_config_preset', description: 'Apply all preset values exactly in a derived snapshot. Unchanged historical keys are retained; rejected or changed unrelated settings prevent publication.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, name: { type: 'string' }, origin: { type: 'string', enum: ['versioned', 'legacy'] }, trial: { type: 'boolean' } }, required: ['snapshot_id', 'name'] } },
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
      return json({ presets, total: all.length, offset, catalogFingerprint: fingerprint, nextOffset: offset + presets.length < all.length ? offset + presets.length : null, warnings: ['The versioned and legacy stores are separate; names present in both require an explicit origin.'] });
    } },
    { schema: read, invoke: async args => {
      if (Object.keys(args).some(key => !['name', 'origin'].includes(key)) || !validPresetName(args.name) || !validOrigin(args.origin)) throw new Error('Invalid preset read options');
      return json({ preset: await store.read(args.name, args.origin as PresetOrigin | undefined), warnings: ['Reading a preset does not change a build. Legacy presets do not carry PoB identity or snapshot provenance.'] });
    } },
  ];
}
export function createSnapshotConfigPresetTools(foundation: Pick<BuildFoundation, 'inspect' | 'deriveExactConfig'>, store: ConfigPresetStore): FeatureTool[] {
  const [, , save, apply] = configPresetSchemas();
  return [
    { schema: save, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'name', 'overwrite'].includes(key)) || !validId(args.snapshot_id) || !validPresetName(args.name) || (args.overwrite !== undefined && typeof args.overwrite !== 'boolean')) throw new Error('Invalid preset save options');
      const observation = await foundation.inspect(args.snapshot_id as string, ['config']);
      const config = Array.isArray(observation.data.config) && observation.data.config.length === 0 ? {} : observation.data.config;
      validatePresetConfig(config);
      const identity = Object.fromEntries(identityKeys.map(key => [key, observation.identity[key] ?? null]));
      const preset = { name: args.name, origin: 'versioned' as const, config, sourceSnapshotId: observation.snapshotId, sourceIdentity: identity, savedAt: new Date().toISOString() };
      await store.save(preset, args.overwrite === true);
      return json({ name: preset.name, origin: preset.origin, sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt, keyCount: Object.keys(config).length, warnings: [...observation.warnings, 'The legacy preset store is not modified. Applying this preset requires a separate snapshot operation.'] });
    } },
    { schema: apply, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'name', 'origin', 'trial'].includes(key)) || !validId(args.snapshot_id) || !validPresetName(args.name) || !validOrigin(args.origin) || (args.trial !== undefined && typeof args.trial !== 'boolean')) throw new Error('Invalid preset apply options');
      const preset = await store.read(args.name, args.origin as PresetOrigin | undefined);
      const result = await foundation.deriveExactConfig(args.snapshot_id as string, preset.config, args.trial === true);
      const mismatched = identityKeys.filter(key => preset.sourceIdentity?.[key] && result.snapshot[key] && preset.sourceIdentity[key] !== result.snapshot[key]);
      const unknown = identityKeys.filter(key => !preset.sourceIdentity?.[key] || !result.snapshot[key]);
      return json({ preset: { name: preset.name, origin: preset.origin, sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt }, snapshot: snapshotMetadata(result.snapshot), changedKeys: result.changedKeys, identityDifferences: mismatched, identityUnknown: unknown,
        warnings: ['All saved values were checked after application and reload. Target settings absent from the preset were preserved.', 'Preset files and the parent snapshot were not changed.', ...(mismatched.length ? ['Preset source and target PoB identities differ; exact application does not establish equivalent game mechanics.'] : []), ...(unknown.length ? ['Some source or target PoB identities are unknown.'] : [])] });
    } },
  ];
}
