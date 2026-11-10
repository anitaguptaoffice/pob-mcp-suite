export interface CraftScenario { name: string; successProbability: number; chaosPerAttempt: number; probabilitySource: string }
export interface CraftProjection extends CraftScenario { expectedAttempts: number; expectedChaos: number; attempts50: number; attempts90: number; chaos50: number; chaos90: number }

/** Geometric model. It never derives game probabilities or market prices. */
export function compareCraftBudget(scenarios: CraftScenario[], buyChaos?: number) {
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.length > 10) throw new Error('provide 1–10 scenarios');
  if (buyChaos !== undefined && (!Number.isFinite(buyChaos) || buyChaos < 0)) throw new Error('invalid buyChaos');
  const results: CraftProjection[] = scenarios.map(scenario => {
    if (!scenario || typeof scenario.name !== 'string' || !scenario.name.trim() ||
        typeof scenario.probabilitySource !== 'string' || !scenario.probabilitySource.trim() ||
        !Number.isFinite(scenario.successProbability) || scenario.successProbability <= 0 || scenario.successProbability > 1 ||
        !Number.isFinite(scenario.chaosPerAttempt) || scenario.chaosPerAttempt < 0) throw new Error('invalid scenario');
    const p = scenario.successProbability;
    const attempts = (target: number) => p === 1 ? 1 : Math.ceil(Math.log1p(-target) / Math.log1p(-p));
    const expectedAttempts = 1 / p;
    const attempts50 = attempts(0.5), attempts90 = attempts(0.9);
    const expectedChaos = expectedAttempts * scenario.chaosPerAttempt;
    const chaos50 = attempts50 * scenario.chaosPerAttempt, chaos90 = attempts90 * scenario.chaosPerAttempt;
    if (![expectedAttempts, attempts50, attempts90, expectedChaos, chaos50, chaos90].every(Number.isFinite)) throw new Error('scenario values exceed supported range');
    return { ...scenario, expectedAttempts, expectedChaos, attempts50, attempts90, chaos50, chaos90 };
  });
  return { currency: 'chaos', buyChaos, scenarios: results, model: 'independent_attempts', warnings: [
    'Probability and cost per attempt are supplied by the caller, not calculated or verified by this tool.',
    'Assumes independent attempts, constant success probability and cost, and retries at the same cost; excludes base items, residual value, additional steps, and price changes.',
    'Expected cost is not a budget ceiling; 50% and 90% refer to theoretical probabilities of at least one success within the stated attempts.',
  ] };
}
