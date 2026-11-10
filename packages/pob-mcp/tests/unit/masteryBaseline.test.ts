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
});
