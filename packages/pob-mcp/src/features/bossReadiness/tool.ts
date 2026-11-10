import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const thresholds = {
  shaper: { name: 'The Shaper', difficulty: 'standard', enemyMode: 'Pinnacle', life: 5000, damage: 1_000_000, ehp: 30_000 },
  elder: { name: 'The Elder', difficulty: 'standard', enemyMode: 'Pinnacle', life: 5000, damage: 800_000, ehp: 25_000 },
  sirus: { name: 'Sirus, Awakener of Worlds', difficulty: 'standard', enemyMode: 'Pinnacle', life: 5500, damage: 2_000_000, ehp: 35_000 },
  maven: { name: 'The Maven', difficulty: 'standard', enemyMode: 'Pinnacle', life: 6000, damage: 3_000_000, ehp: 40_000 },
  uber_elder: { name: 'Uber Elder', difficulty: 'standard_encounter', enemyMode: 'Pinnacle', life: 6000, damage: 1_500_000, ehp: 40_000 },
  uber_eater: { name: 'The Eater of Worlds', difficulty: 'uber', enemyMode: 'Uber', life: 6000, damage: 4_000_000, ehp: 50_000 },
  uber_exarch: { name: 'The Searing Exarch', difficulty: 'uber', enemyMode: 'Uber', life: 6000, damage: 4_000_000, ehp: 50_000 },
  pinnacle: { name: 'Generic pinnacle', difficulty: 'generic', enemyMode: 'Pinnacle', life: 6000, damage: 3_000_000, ehp: 40_000 },
} as const;
const damageFields = ['CombinedDPS', 'TotalDPS', 'MinionCombinedDPS', 'MinionTotalDPS', 'FullDPS'] as const;
const fields = ['Life', 'EnergyShield', 'TotalEHP', ...damageFields, 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'EffectiveSpellSuppressionChance', 'SpellSuppressionChance', 'Armour', 'PhysicalDamageReduction', 'EvasionChance'];
type DamageField = typeof damageFields[number];
const bossIds = Object.keys(thresholds);

type Metric = { status: string; value: number | null };
export function summarizeReadiness(boss: keyof typeof thresholds, metrics: Record<string, Metric>, damageMetric?: DamageField) {
  const reference = thresholds[boss];
  const value = (key: string) => {
    const metric = metrics[key];
    return metric?.status === 'available' && typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : undefined;
  };
  const player = ['CombinedDPS', 'TotalDPS'].some(key => (value(key) ?? 0) > 0);
  const minion = ['MinionCombinedDPS', 'MinionTotalDPS'].some(key => (value(key) ?? 0) > 0);
  const selected = damageMetric ?? (player === minion ? undefined : player ? ((value('CombinedDPS') ?? 0) > 0 ? 'CombinedDPS' : 'TotalDPS') : ((value('MinionCombinedDPS') ?? 0) > 0 ? 'MinionCombinedDPS' : 'MinionTotalDPS'));
  const life = value('Life');
  const make = (metric: string, current: number | undefined, minimum: number, reason?: string) => ({ metric, value: current ?? null, referenceMinimum: minimum, status: reason || current === undefined ? 'unknown' : current >= minimum ? 'above_reference' : 'below_reference', ...(reason ? { reason } : current === undefined ? { reason: 'PoB did not provide a numeric value' } : {}) });
  const lifeReason = life === 1 ? 'Life threshold is not applicable to a one-life build' : undefined;
  const damageReason = !selected ? player && minion ? 'Player and minion damage are both present; select the relevant metric explicitly' : 'No unambiguous damage metric is available; select one explicitly' : undefined;
  const checks = [make('Life', life, reference.life, lifeReason), make('TotalEHP', value('TotalEHP'), reference.ehp), make(selected ?? 'damage', selected ? value(selected) : undefined, reference.damage, damageReason),
    ...['FireResist', 'ColdResist', 'LightningResist'].map(key => make(key, value(key), 75)), make('ChaosResist', value('ChaosResist'), 0)];
  return { reference, selectedDamageMetric: selected ?? null, availableDamage: Object.fromEntries(damageFields.map(key => [key, value(key) ?? null])), checks };
}

export function bossReadinessSchema(): FeatureTool['schema'] {
  return { name: 'assess_snapshot_boss_reference', description: 'Compare snapshot stats with legacy rough boss reference thresholds; this does not prove readiness. Select damage metric when player and minion outputs coexist. Encounter mode temporarily applies PoB boss configuration.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, boss: { type: 'string', enum: bossIds }, damage_metric: { type: 'string', enum: damageFields }, enemy_mode: { type: 'string', enum: ['saved', 'encounter'] },
  }, required: ['snapshot_id', 'boss'] } };
}
export function createBossReadinessTool(foundation: Pick<BuildFoundation, 'evaluate'>): FeatureTool {
  return { schema: bossReadinessSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'boss', 'damage_metric', 'enemy_mode'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.boss !== 'string' || !bossIds.includes(args.boss) || (args.damage_metric !== undefined && !damageFields.includes(args.damage_metric as DamageField)) || (args.enemy_mode !== undefined && args.enemy_mode !== 'saved' && args.enemy_mode !== 'encounter')) throw new Error('Invalid boss reference options; boss and difficulty must match a supported explicit identifier');
    const boss = args.boss as keyof typeof thresholds, enemyMode = args.enemy_mode ?? 'saved';
    const evaluation = await foundation.evaluate(args.snapshot_id, fields, enemyMode === 'encounter' ? { config: { enemyIsBoss: thresholds[boss].enemyMode } } : {});
    const summary = summarizeReadiness(boss, evaluation.metrics as Record<string, Metric>, args.damage_metric as DamageField | undefined);
    const config = evaluation.context.config && typeof evaluation.context.config === 'object' && !Array.isArray(evaluation.context.config) ? evaluation.context.config as Record<string, unknown> : {};
    const configuredEnemy = typeof config.enemyIsBoss === 'string' ? config.enemyIsBoss : null;
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: evaluation.snapshotId, identity: evaluation.identity, ...summary, metrics: evaluation.metrics, enemyConfiguration: { source: enemyMode, expected: thresholds[boss].enemyMode, actual: configuredEnemy, matches: configuredEnemy === null ? null : configuredEnemy === thresholds[boss].enemyMode }, context: evaluation.context,
      warnings: [...evaluation.warnings, 'These unverified legacy thresholds are rough references, not proof of boss readiness or an official game requirement.', 'EHP depends on the configured enemy and damage mix; maximum hit, recovery, mechanics, skill uptime, encounter phase and player execution are not evaluated.', 'Damage metrics are not additive by default. TotalDPS and MinionTotalDPS can omit damage over time; verify skill selection, stacking and poison assumptions.', 'Uber Elder is the named standard encounter, distinct from an Uber pinnacle difficulty. Resistance thresholds are reference values, not the build-specific maximum.'] }) }] };
  } };
}
