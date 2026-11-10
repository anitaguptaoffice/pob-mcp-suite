import { describe, expect, it, jest } from '@jest/globals';
import { handleGetPassiveUpgrades } from '../../src/handlers/treeHandlers.js';

const makeContext = (stats: Record<string, number>) => {
  const calcWith = jest.fn(async (params: { addNodes?: Array<number | string> }) => ({
    TotalDPS: params.addNodes?.includes(101) ? 130 : 120,
    TotalEHP: 1000,
  }));
  const nodes = [
    { id: 101, name: 'Long Path', type: 'notable', stats: [], pathNodes: [100, 101] },
    { id: 102, name: 'Short Path', type: 'notable', stats: [], pathNodes: [102] },
    { id: 103, name: 'Unreachable', type: 'notable', stats: [] },
  ];
  const luaClient = {
    getStats: async () => stats,
    getBuildInfo: async () => ({ level: 90 }),
    getTree: async () => ({ nodes: [], ascendancyPointsUsed: 0 }),
    getItems: async () => [],
    getSkills: async () => ({ groups: [] }),
    searchNodes: async () => ({ nodes }),
    calcWith,
  };
  const context = { ensureLuaClient: async () => {}, getLuaClient: () => luaClient } as unknown as Parameters<typeof handleGetPassiveUpgrades>[0];
  return { context, calcWith };
};

describe('passive path simulation', () => {
  it('simulates complete reachable paths and ranks gain per point', async () => {
    const { context, calcWith } = makeContext({ TotalDPS: 100, TotalEHP: 1000, Life: 1000 });
    const result = await handleGetPassiveUpgrades(context, 'dps');
    const text = result.content[0].text;
    expect(calcWith).toHaveBeenCalledTimes(2);
    expect(calcWith).toHaveBeenCalledWith({ addNodes: [100, 101] });
    expect(calcWith).toHaveBeenCalledWith({ addNodes: [102] });
    expect(text.indexOf('Short Path')).toBeLessThan(text.indexOf('Long Path'));
    expect(text).toContain('路径（2 点）：100 → 101');
    expect(text).not.toContain('Unreachable');
  });

  it('does not fabricate a damage baseline when damage is unavailable', async () => {
    const { context, calcWith } = makeContext({ Life: 1000 });
    const result = await handleGetPassiveUpgrades(context, 'dps');
    expect(result.content[0].text).toContain('无法取得用于比较的非零伤害或防御基准');
    expect(calcWith).not.toHaveBeenCalled();
  });

  it('scores minion combined DPS when poison adds damage beyond hits', async () => {
    const client = {
      getStats: async () => ({ CombinedDPS: 0, TotalDPS: 0, MinionTotalDPS: 100, MinionCombinedDPS: 150, Life: 1000 }),
      getBuildInfo: async () => ({ level: 1 }), getTree: async () => ({ nodes: [] }),
      getItems: async () => [], getSkills: async () => ({ groups: [] }),
      searchNodes: async () => ({ nodes: [{ id: 123, name: 'Poison node', type: 'notable', stats: [], pathNodes: [123] }] }),
      calcWith: async () => ({ Minion: { TotalDPS: 100, CombinedDPS: 200 }, Life: 1000 }),
    };
    const context = { ensureLuaClient: async () => {}, getLuaClient: () => client } as unknown as Parameters<typeof handleGetPassiveUpgrades>[0];
    const result = await handleGetPassiveUpgrades(context, 'dps');
    expect(result.content[0].text).toContain('MinionCombinedDPS = 150');
    expect(result.content[0].text).toContain('MinionCombinedDPS Δ: +50');
  });
});
