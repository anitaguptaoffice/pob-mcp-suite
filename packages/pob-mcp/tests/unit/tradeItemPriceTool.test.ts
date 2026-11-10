import { createTradeItemPriceTool } from '../../src/features/tradePrice/tool.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const time = '2026-01-01T00:00:00.000Z';

describe('named item asking price sampling', () => {
  it('uses instant buyout filters and separates currencies, missing listings and invalid prices', async () => {
    let query: TradeQuery | undefined;
    const source = {
      search: async (league: string, value: TradeQuery) => { query = value; return { source: 'official-trade', fetchedAt: time, request: { league, query: value }, data: { id: 'q', total: 100, result: ['a', 'b', 'c', 'd', 'missing'], inexact: true } }; },
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { missingIds: ['missing'], listings: [
        { id: 'a', item: {}, listing: { price: { amount: 2, currency: 'chaos' } } },
        { id: 'b', item: {}, listing: { price: { amount: 4, currency: 'chaos' } } },
        { id: 'c', item: {}, listing: { price: { amount: 0.005, currency: 'divine' } } },
        { id: 'd', item: {}, listing: { price: { amount: 0, currency: 'chaos' } } },
      ] } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createTradeItemPriceTool(source).invoke({ league: 'Standard', item_name: 'Goldrim', rarity: 'unique', limit: 5 })).content[0].text);
    expect(query?.query.status?.option).toBe('securable');
    expect(report.searchId).toBe('q');
    expect(query?.query.filters?.trade_filters?.filters?.sale_type?.option).toBe('priced');
    expect(report.byCurrency).toEqual([
      { currency: 'chaos', sampleCount: 2, min: 2, median: 3, average: 3, max: 4 },
      { currency: 'divine', sampleCount: 1, min: 0.005, median: 0.005, average: 0.005, max: 0.005 },
    ]);
    expect(report).toMatchObject({ totalMatches: 100, inexact: true, requestedCount: 5, fetchedCount: 4, pricedCount: 3, unpricedOrInvalidCount: 1, missingListingIds: ['missing'], sourceTimes: { search: time, listings: time } });
    expect(report.warnings.join(' ')).toContain('not a complete market appraisal');
  });

  it('rejects invalid requests without calling the source', async () => {
    const source = { search: jest.fn() } as unknown as OfficialTradeSource;
    const tool = createTradeItemPriceTool(source);
    for (const args of [{ league: 'Standard', item_name: '' }, { item_name: 'Goldrim' }, { league: 'Standard', item_name: 'Goldrim', status: 'any' }, { league: 'Standard', item_name: 'Goldrim', rarity: 'other' }, { league: 'Standard', item_name: 'Goldrim', limit: 11 }]) await expect(tool.invoke(args)).rejects.toThrow();
    expect(source.search).not.toHaveBeenCalled();
  });

  it('does not overflow when aggregating large finite prices', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query }, data: { id: 'q', total: 2, result: ['a', 'b'] } }),
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { missingIds: [], listings: ids.map(id => ({ id, item: {}, listing: { price: { amount: Number.MAX_VALUE, currency: 'chaos' } } })) } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createTradeItemPriceTool(source).invoke({ league: 'Standard', item_name: 'Goldrim' })).content[0].text);
    expect(report.byCurrency[0].median).toBe(Number.MAX_VALUE);
    expect(report.byCurrency[0].average).toBe(Number.MAX_VALUE);
  });
});
