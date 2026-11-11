type Metric = { status?: unknown; value?: unknown } | undefined;
type Check = { metric: string; threshold: number; comparison: 'at_least' | 'above'; value: number | null; meets: boolean | null };

/** Legacy-inspired thresholds are observations, not proof of survival or uptime. */
export function defenseReference(metrics: Record<string, Metric>) {
  const number = (name: string, minimum = 0, maximum = Number.POSITIVE_INFINITY): number | null => {
    const metric = metrics[name], value = metric?.value;
    return metric?.status === 'available' && typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
  };
  const check = (metric: string, threshold: number, value: number | null, comparison: Check['comparison'] = 'at_least'): Check => ({ metric, threshold, comparison, value, meets: value === null ? null : comparison === 'above' ? value > threshold : value >= threshold });
  const suppressionEffective = number('EffectiveSpellSuppressionChance', 0, 100);
  const suppressionBase = number('SpellSuppressionChance', 0, 100);
  const life = number('Life'), regen = number('LifeRegen', Number.NEGATIVE_INFINITY);
  const ratio = life !== null && life > 1 && regen !== null && Number.isFinite(regen / life * 100) ? regen / life * 100 : null;
  const layers = {
    avoidance: [check('Evasion', 10000, number('Evasion')), check(suppressionEffective === null ? 'SpellSuppressionChance' : 'EffectiveSpellSuppressionChance', 50, suppressionEffective ?? suppressionBase), check('AttackDodgeChance', 20, number('AttackDodgeChance', 0, 100)), check('BlockChance', 20, number('BlockChance', 0, 100))],
    mitigation: [check('Armour', 10000, number('Armour')), check('PhysicalDamageReduction', 20, number('PhysicalDamageReduction', 0, 100))],
    recovery: [check('LifeRegenPercentOfLife', 1, ratio), check('EnergyShieldRecharge', 200, number('EnergyShieldRecharge')), check('LifeLeechGainRate', 0, number('LifeLeechGainRate'), 'above')],
  };
  const reference = Object.fromEntries(Object.entries(layers).map(([name, checks]) => [name, {
    status: checks.some(entry => entry.meets === true) ? 'threshold_met' : checks.some(entry => entry.meets === null) ? 'unknown' : 'below_threshold', checks,
  }]));
  return { layers: reference, warnings: [
    'These thresholds are arbitrary reference signals, not proof that a defensive layer is active, sufficient or missing.',
    'Values depend on the saved PoB conditions; leech and recharge rates do not establish uptime. Life regeneration percentage is unknown for one-life builds.',
    'Maximum endurance charges do not establish current charges and are not counted. The checks omit other mitigation, avoidance and recovery mechanics.',
  ] };
}
