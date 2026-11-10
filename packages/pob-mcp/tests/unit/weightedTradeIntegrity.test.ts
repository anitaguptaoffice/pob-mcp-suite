import { describe, expect, it, jest } from '@jest/globals';
import { handleFindWeightedTradeItems } from '../../src/handlers/tradeHandlers';

describe('weighted trade search', () => {
  it('enforces securable on the actual PoB-generated query and discloses inexact results', async () => {
    const original = process.env.POE_SESSION_ID;
    process.env.POE_SESSION_ID = 'unit-test';
    try {
      const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({ id: 'q', total: 0, result: [], inexact: true }));
      const generateWeightedTradeQuery = jest.fn(async () => ({ query: { query: { status: { option: 'available' }, stats: [] }, sort: { price: 'asc' } } }));
      const result = await handleFindWeightedTradeItems({ tradeClient: { searchItems } as any, getLuaClient: () => ({ generateWeightedTradeQuery } as any), ensureLuaClient: async () => {} }, { league: 'League', slot: 'Amulet' });
      expect(searchItems.mock.calls[0][1].query.status.option).toBe('securable');
      expect(result.content[0].text).toContain('近似匹配');
      expect(result.content[0].text).not.toContain('BIS');
    } finally {
      if (original === undefined) delete process.env.POE_SESSION_ID; else process.env.POE_SESSION_ID = original;
    }
  });
});
