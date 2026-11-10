import { describe, expect, it, jest } from '@jest/globals';
import { handleSuggestMasteries } from '../../src/handlers/treeHandlers.js';

describe('mastery baseline', () => {
  it('refuses to rank effects when damage data is absent', async () => {
    const calcWith = jest.fn();
    const client = { getMasteryOptions: async () => ({ masteries: [{ nodeId: 1, nodeName: 'test', availableEffects: [] }] }), getStats: async () => ({ Life: 500 }), calcWith };
    const context = { ensureLuaClient: async () => {}, getLuaClient: () => client } as unknown as Parameters<typeof handleSuggestMasteries>[0];
    const result = await handleSuggestMasteries(context);
    expect(result.content[0].text).toContain('无法取得非零伤害和防御基准');
    expect(calcWith).not.toHaveBeenCalled();
  });

  it('does not silently choose player damage when minions also deal damage', async () => {
    const calcWith = jest.fn(async () => ({ CombinedDPS: 10, Minion: { CombinedDPS: 200 }, Life: 500 }));
    const client = { getMasteryOptions: async () => ({ masteries: [{ nodeId: 1, nodeName: 'test', availableEffects: [{ effectId: 2, stat: 'minion effect' }] }] }),
      getStats: async () => ({ CombinedDPS: 10, MinionCombinedDPS: 100, Life: 500 }), calcWith };
    const context = { ensureLuaClient: async () => {}, getLuaClient: () => client } as unknown as Parameters<typeof handleSuggestMasteries>[0];
    await expect(handleSuggestMasteries(context)).rejects.toThrow('specify damage_metric');
    expect(calcWith).not.toHaveBeenCalled();
    const result = await handleSuggestMasteries(context, 'MinionCombinedDPS');
    expect(result.content[0].text).toContain('MinionCombinedDPS = 100');
    expect(result.content[0].text).toContain('MinionCombinedDPS Δ +100');
  });
});
