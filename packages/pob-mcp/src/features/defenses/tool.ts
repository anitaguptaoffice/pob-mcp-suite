import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export const defenseGroups = {
  pools: ['Life', 'LifeUnreserved', 'EnergyShield', 'Ward', 'Mana', 'ManaUnreserved', 'TotalEHP'],
  resistances: ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'MissingFireResist', 'MissingColdResist', 'MissingLightningResist', 'FireResistOverCap', 'ColdResistOverCap', 'LightningResistOverCap', 'ChaosResistOverCap'],
  avoidance: ['Evasion', 'EvasionChance', 'BlockChance', 'SpellBlockChance', 'AttackDodgeChance', 'SpellDodgeChance', 'SpellSuppressionChance', 'EffectiveSpellSuppressionChance'],
  mitigation: ['Armour', 'PhysicalDamageReduction', 'PhysicalMaximumHitTaken', 'FireMaximumHitTaken', 'ColdMaximumHitTaken', 'LightningMaximumHitTaken', 'ChaosMaximumHitTaken'],
  recovery: ['LifeRegen', 'LifeRegenRecovery', 'LifeLeechGainRate', 'EnergyShieldRegen', 'EnergyShieldRegenRecovery', 'EnergyShieldLeechGainRate', 'EnergyShieldRecharge', 'ManaRegen', 'ManaRegenRecovery', 'ManaLeechGainRate'],
} as const;
export const defenseFields = Object.values(defenseGroups).flat();

export function snapshotDefensesSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_defenses', description: 'Read grouped PoB defensive metrics for an explicit snapshot with saved calculation context; unavailable values remain unknown.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}
export function createSnapshotDefensesTool(foundation: Pick<BuildFoundation, 'evaluate'>): FeatureTool {
  return { schema: snapshotDefensesSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Invalid snapshot defense options');
    const result = await foundation.evaluate(args.snapshot_id, [...defenseFields]);
    const groups = Object.fromEntries(Object.entries(defenseGroups).map(([name, fields]) => [name, Object.fromEntries(fields.map(field => [field, result.metrics[field] ?? { status: 'unknown', value: null, reason: 'PoB did not provide this metric' }]))]));
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: result.snapshotId, identity: result.identity, context: result.context, groups,
      warnings: [...result.warnings, 'Defensive metrics depend on the saved PoB enemy and character configuration; EHP is not a guarantee of survival.', 'Maximum hit, avoidance, mitigation and recovery measure different situations and must not be added together.', 'Missing metrics are unknown, not zero; this report does not assign a defensive score or prove in-game uptime.'] }) }] };
  } };
}
