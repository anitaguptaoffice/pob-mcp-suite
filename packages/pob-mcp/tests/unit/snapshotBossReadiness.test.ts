import { createBossReadinessTool, summarizeReadiness } from '../../src/features/bossReadiness/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const metric = (value: number) => ({ status: 'available', value });
const metrics = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, metric(value)]));

describe('snapshot boss reference', () => {
  it('selects poison-inclusive minion damage and treats one life and missing values as unknown', () => {
    const result = summarizeReadiness('shaper', metrics({ Life: 1, EnergyShield: 9000, MinionTotalDPS: 100, MinionCombinedDPS: 250 }));
    expect(result.selectedDamageMetric).toBe('MinionCombinedDPS');
    expect(result.checks.find(check => check.metric === 'MinionCombinedDPS')).toMatchObject({ value: 250, status: 'below_reference' });
    expect(result.checks.find(check => check.metric === 'Life')?.status).toBe('unknown');
    expect(result.checks.find(check => check.metric === 'FireResist')?.status).toBe('unknown');
  });
  it('does not silently choose between player and minion damage or add them together', () => {
    const values = metrics({ CombinedDPS: 5, TotalDPS: 4, MinionCombinedDPS: 20, MinionTotalDPS: 10, FullDPS: 50 });
    const ambiguous = summarizeReadiness('maven', values);
    expect(ambiguous.selectedDamageMetric).toBeNull();
    expect(ambiguous.checks.find(check => check.metric === 'damage')?.status).toBe('unknown');
    const selected = summarizeReadiness('maven', values, 'FullDPS');
    expect(selected.selectedDamageMetric).toBe('FullDPS');
    expect(selected.checks.find(check => check.metric === 'FullDPS')?.value).toBe(50);
  });
  it('retains explicit zero when selected and reports unavailable selected metrics', () => {
    const zero = summarizeReadiness('elder', metrics({ TotalDPS: 0 }), 'TotalDPS');
    expect(zero.checks.find(check => check.metric === 'TotalDPS')).toMatchObject({ value: 0, status: 'below_reference' });
    expect(summarizeReadiness('elder', {}, 'MinionCombinedDPS').checks.find(check => check.metric === 'MinionCombinedDPS')?.status).toBe('unknown');
  });
  it('does not substitute boss or difficulty and validates before evaluation', async () => {
    const evaluate = jest.fn();
    const tool = createBossReadinessTool({ evaluate } as unknown as Pick<BuildFoundation, 'evaluate'>);
    for (const boss of ['uber_shaper', 'eater', 'exarch', 'not-a-boss']) await expect(tool.invoke({ snapshot_id: 'a'.repeat(64), boss })).rejects.toThrow('difficulty');
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('applies the explicit Uber mode and shows the actual configuration without touching saved mode', async () => {
    const evaluate = jest.fn().mockResolvedValue({ snapshotId: 'a'.repeat(64), identity: {}, warnings: [], metrics: metrics({ Life: 2000 }), context: { config: { enemyIsBoss: 'Uber' }, skills: {} } });
    const tool = createBossReadinessTool({ evaluate } as unknown as Pick<BuildFoundation, 'evaluate'>);
    const result = JSON.parse((await tool.invoke({ snapshot_id: 'a'.repeat(64), boss: 'uber_exarch', enemy_mode: 'encounter' })).content[0].text);
    expect(evaluate.mock.calls[0][2]).toEqual({ config: { enemyIsBoss: 'Uber' } });
    expect(result.enemyConfiguration).toEqual({ source: 'encounter', expected: 'Uber', actual: 'Uber', matches: true });
    expect(result.reference.difficulty).toBe('uber');
    await tool.invoke({ snapshot_id: 'a'.repeat(64), boss: 'uber_elder' });
    expect(evaluate.mock.calls[1][2]).toEqual({});
  });
});
