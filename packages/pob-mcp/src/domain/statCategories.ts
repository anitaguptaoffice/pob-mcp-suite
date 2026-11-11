/** Shared field definitions; names are PoB output identifiers, not damage formulae. */
export const OFFENSE_FIELDS = [
  'TotalDPS', 'CombinedDPS', 'TotalDot', 'TotalDotDPS', 'WithBleedDPS', 'WithIgniteDPS',
  'WithPoisonDPS', 'IgniteDPS', 'BleedDPS', 'PoisonDPS', 'AverageDamage', 'AverageBurstDamage',
  'Speed', 'HitChance', 'CritChance', 'CritMultiplier', 'PreEffectiveCritChance',
  'EffectiveCritChance', 'MainHandAccuracy', 'OffHandAccuracy', 'ManaCost', 'ManaPerSecondCost',
  'LifeCost', 'LifePerSecondCost', 'ESCost', 'ESPerSecondCost', 'RageCost',
  'MinionTotalDPS', 'MinionCombinedDPS', 'MinionAverageDamage', 'MinionSpeed',
  'MinionLife', 'MinionArmour', 'MinionEnergyShield',
  'MinionFireResist', 'MinionColdResist', 'MinionLightningResist', 'MinionChaosResist',
] as const;

export const DEFENSE_FIELDS = [
  'Life', 'LifeRegen', 'LifeRegenRecovery', 'LifeLeechGainRate', 'LifeUnreserved',
  'Mana', 'ManaRegen', 'ManaRegenRecovery', 'ManaLeechGainRate', 'ManaUnreserved',
  'EnergyShield', 'EnergyShieldRegen', 'EnergyShieldRegenRecovery', 'EnergyShieldLeechGainRate',
  'Ward', 'Armour', 'Evasion', 'EvasionChance', 'PhysicalDamageReduction',
  'BlockChance', 'SpellBlockChance', 'AttackDodgeChance', 'SpellDodgeChance',
  'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist',
  'FireResistOverCap', 'ColdResistOverCap', 'LightningResistOverCap', 'ChaosResistOverCap',
  'TotalEHP', 'PhysicalMaximumHitTaken', 'FireMaximumHitTaken', 'ColdMaximumHitTaken',
  'LightningMaximumHitTaken', 'ChaosMaximumHitTaken', 'EffectiveSpellSuppressionChance',
] as const;

export function statCategoryFields(category: 'offense' | 'defense' | 'all'): string[] {
  const offense = ['FullDPS', ...OFFENSE_FIELDS];
  if (category === 'offense') return offense;
  if (category === 'defense') return [...DEFENSE_FIELDS];
  return [...new Set([...offense, ...DEFENSE_FIELDS])];
}
