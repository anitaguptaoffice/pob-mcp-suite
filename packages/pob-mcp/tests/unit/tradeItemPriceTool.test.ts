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
        { id: 'a', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 2, currency: 'chaos' } } },
        { id: 'b', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 4, currency: 'chaos' } } },
        { id: 'c', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 0.005, currency: 'divine' } } },
        { id: 'd', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 0, currency: 'chaos' } } },
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

  it('excludes negotiated, untyped, unverified and invalid prices from buyout statistics', async () => {
    const listings = [
      { id: 'a', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 8, currency: 'chaos' } } },
      { id: 'b', item: { league: 'Standard', verified: true }, listing: { price: { type: '~price', amount: 1, currency: 'chaos' } } },
      { id: 'c', item: { league: 'Standard', verified: true }, listing: { price: { amount: 2, currency: 'chaos' } } },
      { id: 'd', item: { league: 'Standard', verified: false }, listing: { price: { type: '~b/o', amount: 3, currency: 'chaos' } } },
      { id: 'e', item: {}, listing: { price: { type: '~b/o', amount: 4, currency: 'chaos' } } },
      { id: 'f', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 0, currency: 'chaos' } } },
      { id: 'g', item: { league: 'Other', verified: true }, listing: { price: { type: '~b/o', amount: 5, currency: 'chaos' } } },
      { id: 'h', item: { verified: true }, listing: { price: { type: '~b/o', amount: 6, currency: 'chaos' } } },
    ];
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query }, data: { id: 'q', total: listings.length, result: listings.map(item => item.id) } }),
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings, missingIds: [] } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createTradeItemPriceTool(source).invoke({ league: 'Standard', item_name: 'Goldrim' })).content[0].text);
    expect(report.byCurrency).toEqual([{ currency: 'chaos', sampleCount: 1, min: 8, median: 8, average: 8, max: 8 }]);
    expect(report.priceEvidenceCounts).toEqual({ explicit_buyout: 1, invalid_price: 1, unconfirmed_buyout: 2, unverified_item: 2, league_unconfirmed: 2 });
    expect(report.pricedCount).toBe(1); expect(report.unpricedOrInvalidCount).toBe(1);
  });

  it('returns no price statistic when none of the fetched listings has confirmed buyout evidence', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query }, data: { id: 'q', total: 1, result: ['a'] } }),
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [{ id: 'a', item: { verified: true, league: 'Standard' }, listing: { price: { type: '~price', amount: 1, currency: 'chaos' } } }], missingIds: [] } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createTradeItemPriceTool(source).invoke({ league: 'Standard', item_name: 'Goldrim' })).content[0].text);
    expect(report.byCurrency).toEqual([]); expect(report.pricedCount).toBe(0);
    expect(report.priceEvidenceCounts.unconfirmed_buyout).toBe(1);
  });

  it('does not overflow when aggregating large finite prices', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query }, data: { id: 'q', total: 2, result: ['a', 'b'] } }),
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { missingIds: [], listings: ids.map(id => ({ id, item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: Number.MAX_VALUE, currency: 'chaos' } } })) } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createTradeItemPriceTool(source).invoke({ league: 'Standard', item_name: 'Goldrim' })).content[0].text);
    expect(report.byCurrency[0].median).toBe(Number.MAX_VALUE);
    expect(report.byCurrency[0].average).toBe(Number.MAX_VALUE);
  });
});
