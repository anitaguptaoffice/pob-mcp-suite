import { describe, expect, it } from '@jest/globals';
import { compareCraftBudget } from '../../src/features/craftBudget/model.js';

describe('craft budget model', () => {
  it('calculates independent-attempt expected and percentile budgets', () => {
    const report = compareCraftBudget([{ name: 'example', successProbability: 0.1, chaosPerAttempt: 2, probabilitySource: 'verified fixture' }], 30);
    expect(report.scenarios[0]).toMatchObject({ expectedAttempts: 10, expectedChaos: 20, attempts50: 7, attempts90: 22, chaos50: 14, chaos90: 44 });
    expect(report.buyChaos).toBe(30);
    expect(report.warnings.join(' ')).toContain('并非此工具计算或验证');
  });

  it('does not invent odds and handles certainty', () => {
    expect(() => compareCraftBudget([{ name: 'bad', successProbability: 0, chaosPerAttempt: 1, probabilitySource: 'source' }])).toThrow();
    expect(() => compareCraftBudget([{ name: 'bad', successProbability: 0.1, chaosPerAttempt: 1, probabilitySource: '' }])).toThrow();
    const [scenario] = compareCraftBudget([{ name: 'certain', successProbability: 1, chaosPerAttempt: 3, probabilitySource: 'fixture' }]).scenarios;
    expect(scenario).toMatchObject({ expectedChaos: 3, attempts50: 1, attempts90: 1 });
  });
});
