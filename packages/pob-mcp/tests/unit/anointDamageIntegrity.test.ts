import { describe, expect, it } from '@jest/globals';
import { handleFindBestAnointment } from '../../src/handlers/anointHandlers.js';

describe('anoint damage reporting', () => {
  it('reports the selected poison-inclusive minion baseline and percentage', async () => {
    const client = { evaluateAnointCandidates: async () => ({ slot: 'Amulet', baseType: 'Amulet', focus: 'dps', evaluated: 1, skipped: 0,
      base: { CombinedDPS: 0, TotalEHP: 1000, damageStat: 'MinionCombinedDPS', damageValue: 200, ehpAvailable: true },
      candidates: [{ nodeId: 1, name: 'example', dpsDelta: 50, ehpDelta: 0, score: 50, recipe: [] }] }) };
    const context = { ensureLuaClient: async () => {}, getLuaClient: () => client } as unknown as Parameters<typeof handleFindBestAnointment>[0];
    const result = await handleFindBestAnointment(context, { slot: 'Amulet', focus: 'dps' });
    expect(result.content[0].text).toContain('MinionCombinedDPS: 200');
    expect(result.content[0].text).toContain('MinionCombinedDPS Δ: +50 (+25.00%)');
  });
});
