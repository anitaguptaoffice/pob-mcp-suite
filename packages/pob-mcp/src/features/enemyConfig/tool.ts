import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import { createSnapshotBuildComparisonTool } from '../buildComparison/tool.js';

const mapping = { level: 'enemyLevel', fire_resist: 'enemyFireResist', cold_resist: 'enemyColdResist', lightning_resist: 'enemyLightningResist', chaos_resist: 'enemyChaosResist', armor: 'enemyArmour', evasion: 'enemyEvasion' } as const;
const defaultFields = ['TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'Life', 'EnergyShield'];
export function enemyConfigSchema(): FeatureTool['schema'] {
  return { name: 'derive_snapshot_enemy_config', description: 'Apply explicit enemy level, resistances, armour and evasion to a verified child snapshot; optionally compare separate PoB damage metrics.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, enemy: { type: 'object', additionalProperties: false, properties: { level: { type: 'integer', minimum: 1 }, fire_resist: { type: 'number' }, cold_resist: { type: 'number' }, lightning_resist: { type: 'number' }, chaos_resist: { type: 'number' }, armor: { type: 'number', minimum: 0 }, evasion: { type: 'number', minimum: 0 } } }, trial: { type: 'boolean' }, compare: { type: 'boolean' }, fields: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string' } } }, required: ['snapshot_id', 'enemy'] } };
}
export function createEnemyConfigTool(foundation: Pick<BuildFoundation, 'inspect' | 'evaluate' | 'deriveExactConfig'>): FeatureTool {
  return { schema: enemyConfigSchema(), invoke: async args => {
    const enemy = args.enemy, fields = args.fields ?? defaultFields;
    if (Object.keys(args).some(key => !['snapshot_id', 'enemy', 'trial', 'compare', 'fields'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !enemy || typeof enemy !== 'object' || Array.isArray(enemy) || Object.keys(enemy).length === 0 || Object.keys(enemy).some(key => !Object.hasOwn(mapping, key)) || Object.entries(enemy).some(([key, value]) => typeof value !== 'number' || !Number.isFinite(value) || (key === 'level' && (!Number.isSafeInteger(value) || value < 1)) || (['armor', 'evasion'].includes(key) && value < 0)) || (args.trial !== undefined && typeof args.trial !== 'boolean') || (args.compare !== undefined && typeof args.compare !== 'boolean') || (args.compare === false && args.fields !== undefined) || !Array.isArray(fields) || fields.length < 1 || fields.length > 20 || fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(fields).size !== fields.length) throw new Error('Invalid enemy configuration options');
    const changes = Object.fromEntries(Object.entries(enemy).map(([key, value]) => [mapping[key as keyof typeof mapping], value])) as Record<string, number>;
    const before = await foundation.inspect(args.snapshot_id, ['config']);
    const previous = before.data.config;
    if (!previous || typeof previous !== 'object' || Array.isArray(previous) && previous.length !== 0) throw new Error('PoB returned invalid enemy configuration');
    const levelSetting = typeof changes.enemyLevel === 'number' ? { mode: 'explicit' as const, value: changes.enemyLevel } : undefined;
    const result = await foundation.deriveExactConfig(args.snapshot_id, changes, args.trial === true, levelSetting);
    const previousValues = Object.fromEntries(Object.entries(mapping).filter(([key]) => Object.hasOwn(enemy, key)).map(([key, configKey]) => [key, Object.hasOwn(previous, configKey) ? (previous as Record<string, unknown>)[configKey] : null]));
    let comparison: unknown = null, comparisonError: string | null = null;
    if (args.compare !== false) {
      try {
        const response = await createSnapshotBuildComparisonTool(foundation).invoke({ baseline_snapshot_id: args.snapshot_id, candidate_snapshot_id: result.snapshot.id, fields });
        comparison = JSON.parse(response.content[0].text);
      } catch (error) { comparisonError = error instanceof Error ? error.message : String(error); }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshot: snapshotMetadata(result.snapshot), previous: previousValues, requested: enemy, appliedConfig: changes, changedKeys: result.changedKeys, comparison, comparisonStatus: args.compare === false ? 'not_requested' : comparisonError ? 'error' : 'available', comparisonError,
      warnings: [...before.warnings, 'Every requested value was checked after application and reload; the parent and unrelated configuration are unchanged.', 'Enemy resistances and defenses are PoB configuration inputs, not proof of actual game encounter behavior.', 'Player, minion and full DPS can overlap; select the relevant metric and do not add them blindly.', ...(comparisonError ? ['The snapshot was created, but metric comparison failed; its ID is preserved for retry.'] : [])] }) }] };
  } };
}
