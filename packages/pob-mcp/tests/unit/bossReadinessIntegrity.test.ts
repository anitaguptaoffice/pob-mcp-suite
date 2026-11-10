import { describe, expect, it, jest } from '@jest/globals';
import { handleCheckBossReadiness } from '../../src/handlers/bossReadinessHandlers.js';

function context(stats: Record<string, number>) {
  const getStats = jest.fn(async () => stats);
  const c = { ensureLuaClient: async () => {}, getLuaClient: () => ({ getStats }) } as unknown as Parameters<typeof handleCheckBossReadiness>[0];
  return { c, getStats };
}

describe('boss readiness data integrity', () => {
  it('does not substitute another boss or difficulty', async () => {
    const { c, getStats } = context({});
    const result = await handleCheckBossReadiness(c, 'uber shaper');
    expect(result.content[0].text).toContain('不会替换成其他首领');
    expect(getStats).not.toHaveBeenCalled();
  });
  it('marks missing stats unknown and uses poison-inclusive minion damage', async () => {
    const { c } = context({ Life: 1, EnergyShield: 9000, MinionTotalDPS: 100, MinionCombinedDPS: 250 });
    const text = (await handleCheckBossReadiness(c, 'shaper')).content[0].text;
    expect(text).toContain('MinionCombinedDPS');
    expect(text).toContain('❔ Life: 1');
    expect(text).toContain('Fire Resist: 未提供');
    expect(text).not.toContain('READY');
    expect(text).not.toContain('-60%');
  });
});
