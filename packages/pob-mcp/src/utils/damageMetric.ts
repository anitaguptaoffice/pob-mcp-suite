import { toFiniteNumber } from '../pobLuaBridge.js';

export const DAMAGE_METRICS = ['CombinedDPS', 'TotalDPS', 'MinionCombinedDPS', 'MinionTotalDPS'] as const;
export type DamageMetric = typeof DAMAGE_METRICS[number];

/** Choose only when the available player/minion baselines do not conflict. */
export function selectDamageMetric(stats: Record<string, unknown>, requested?: string): DamageMetric | undefined {
  if (requested !== undefined) {
    if (!DAMAGE_METRICS.includes(requested as DamageMetric)) throw new Error('invalid damage_metric');
    return (toFiniteNumber(stats[requested]) ?? 0) > 0 ? requested as DamageMetric : undefined;
  }
  const player = (['CombinedDPS', 'TotalDPS'] as const).find(key => (toFiniteNumber(stats[key]) ?? 0) > 0);
  const minion = (['MinionCombinedDPS', 'MinionTotalDPS'] as const).find(key => (toFiniteNumber(stats[key]) ?? 0) > 0);
  if (player && minion) throw new Error('Both player and minion damage are positive; specify damage_metric explicitly to select the metric to rank.');
  return player ?? minion;
}
