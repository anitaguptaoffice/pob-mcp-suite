import { describe, expect, it, jest } from '@jest/globals';
import { handleGetItemPrice } from '../../src/handlers/tradeHandlers.js';
import type { TradeApiClient } from '../../src/services/tradeClient.js';

describe('instant-buyout price integrity', () => {
  it('requires the exact league before making a trade request', async () => {
    const searchItems = jest.fn();
    await expect(handleGetItemPrice({ tradeClient: { searchItems } as unknown as TradeApiClient }, { item_name: 'Test' })).rejects.toThrow('exact international league');
    expect(searchItems).not.toHaveBeenCalled();
  });
  it('uses instant buyout and reports grouped sample prices with an even median', async () => {
    const searchItems = jest.fn(async (_league: string, _query: unknown) => ({ id: 'query', result: ['a', 'b', 'c', 'd'], total: 100, inexact: true }));
    const fetchItems = jest.fn(async () => [
      { listing: { price: { amount: 2, currency: 'chaos' } } },
      { listing: { price: { amount: 4, currency: 'chaos' } } },
      { listing: { price: { amount: 0.005, currency: 'divine' } } },
      { listing: { price: { amount: 0, currency: 'chaos' } } },
    ]);
    const result = await handleGetItemPrice({ tradeClient: { searchItems, fetchItems } as unknown as TradeApiClient }, { item_name: 'Test', league: 'Standard' });
    const query = searchItems.mock.calls[0][1] as any;
    expect(query.query.status.option).toBe('securable');
    expect(query.query.filters.trade_filters.filters.sale_type.option).toBe('priced');
    expect(result.content[0].text).toContain('Median: 3 chaos');
    expect(result.content[0].text).toContain('0.005 divine');
    expect(result.content[0].text).toContain('近似匹配');
    expect(result.content[0].text).toContain('不是成交价');
    expect(result.content[0].text).toContain('/Standard/query');
  });
  it('discloses an inexact search even if it has no results', async () => {
    const client = { searchItems: async () => ({ id: 'q', result: [], total: 0, inexact: true }) } as unknown as TradeApiClient;
    const text = (await handleGetItemPrice({ tradeClient: client }, { item_name: 'Test', league: 'Standard' })).content[0].text;
    expect(text).toContain('近似匹配');
    expect(text).toContain('/Standard/q');
  });
});
