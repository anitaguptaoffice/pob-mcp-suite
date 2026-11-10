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
    '概率和单次成本由调用方提供，并非此工具计算或验证的游戏数据。',
    '假设每次尝试独立、成功概率和成本不变，失败后可按相同成本继续；不包含底材、残值、额外步骤或价格波动。',
    '平均成本不是预算上限；50% 和 90% 只表示在对应次数内至少成功一次的理论概率。',
  ] };
}
