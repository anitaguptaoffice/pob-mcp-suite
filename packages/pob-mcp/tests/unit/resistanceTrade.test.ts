import { createResistanceTradeTool } from '../../src/features/resistanceTrade/tool.js';
import { ItemRecommendationEngine } from '../../src/services/itemRecommendationEngine.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const at = '2026-01-01T00:00:00.000Z';
const stats = { result: [{ entries: [{ id: 'pseudo.pseudo_total_fire_resistance', text: '+#% total to Fire Resistance', type: 'pseudo' }, { id: 'pseudo.pseudo_total_chaos_resistance', text: '+#% total to Chaos Resistance', type: 'pseudo' }] }] };

describe('resistance listing workflow', () => {
  it('matches the previous query while filtering different currencies and retaining timestamps', async () => {
    let oldQuery: TradeQuery | undefined, query: TradeQuery | undefined;
    const old = new ItemRecommendationEngine({ searchItems: async (_league: string, value: TradeQuery) => { oldQuery = value; return { id: 'q', result: [], total: 0 }; } } as any);
    await old.findResistanceGear({ fire: 40, cold: 0, lightning: 0, chaos: 10 }, { maxPricePerItem: 20, totalBudget: 20, currency: 'chaos' }, 'Standard', ['Ring 1']);
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: at, request: { kind: 'stats' }, data: stats }),
      search: async (league: string, value: TradeQuery) => { query = value; return { source: 'official-trade', fetchedAt: at, request: { league, query: JSON.parse(JSON.stringify(value)) }, data: { id: 'q', result: ['a', 'b', 'missing'], total: 10, inexact: true } }; },
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids, queryId }, data: { missingIds: ['missing'], listings: [
        { id: 'a', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 10, currency: 'chaos' } } }, { id: 'b', item: { league: 'Standard', verified: true }, listing: { price: { type: '~b/o', amount: 1, currency: 'divine' } } },
      ] } }),
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createResistanceTradeTool(source).invoke({ league: 'Standard', resistance_minimums: { fire: 40, chaos: 10 }, max_price_per_item: 50, total_budget: 20, slots: ['Ring 1'], per_slot_limit: 3 })).content[0].text);
    expect(JSON.parse(JSON.stringify(query))).toEqual(JSON.parse(JSON.stringify(oldQuery)));
    expect(result).toMatchObject({ listingScope: 'instant_buyout', effectivePerItemCap: 20, currency: 'chaos' });
    expect(result.searches[0]).toMatchObject({ status: 'ok', inexact: true, missingListingIds: ['missing'], excludedPriceCount: 1, sourceTimes: { stats: at, search: at, listings: at } });
    expect(result.searches[0].listings.map((entry: { id: string }) => entry.id)).toEqual(['a']);
    expect(result.searches[0].priceEvidenceCounts.explicit_buyout).toBe(2);
    expect(result.searches[0].excludedBudgetCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('combined affordability');
  });
  it('stops after rate limiting and reports unattempted slots', async () => {
    const search = jest.fn(async () => { throw Object.assign(new Error('cooldown'), { code: 'rate-limit', httpStatus: 429, retryAfterMs: 3000 }); });
    const source = { search } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createResistanceTradeTool(source).invoke({ league: 'Standard', slots: ['Ring 1', 'Boots'] })).content[0].text);
    expect(result.searches).toEqual([{ slot: 'Ring 1', status: 'error', error: 'cooldown', code: 'rate-limit', httpStatus: 429, retryAfterMs: 3000 }, { slot: 'Boots', status: 'not_attempted', error: 'Official Trade rate limit stopped this workflow' }]);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('returns only confirmed buyouts and keeps excluded evidence separate from source statistics', async () => {
    const listings = [
      { id: 'a', item: { verified: true, league: 'Standard' }, listing: { price: { type: '~b/o', amount: 5, currency: 'chaos' } } },
      { id: 'b', item: { verified: true, league: 'Standard' }, listing: { price: { type: '~price', amount: 1, currency: 'chaos' } } },
      { id: 'c', item: { verified: false, league: 'Standard' }, listing: { price: { type: '~b/o', amount: 2, currency: 'chaos' } } },
      { id: 'd', item: { verified: true, league: 'Other' }, listing: { price: { type: '~b/o', amount: 3, currency: 'chaos' } } },
      { id: 'e', item: { verified: true, league: 'Standard' }, listing: {} },
    ];
    const source = { search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: at, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', result: listings.map(item => item.id), total: listings.length } }),
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids, queryId }, data: { listings, missingIds: [] } }) } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createResistanceTradeTool(source).invoke({ league: 'Standard', slots: ['Ring 1'], per_slot_limit: 5 })).content[0].text);
    expect(result.searches[0].listings.map((item: { id: string }) => item.id)).toEqual(['a']);
    expect(result.searches[0].priceEvidenceCounts).toEqual({ explicit_buyout: 1, invalid_price: 1, unconfirmed_buyout: 1, unverified_item: 1, league_unconfirmed: 1 });
    expect(result.searches[0].sourceStatistics.sampleCount).toBe(5);
  });
  it('does not query zero budget and rejects unsupported inputs before network', async () => {
    const search = jest.fn(); const source = { search } as unknown as OfficialTradeSource;
    const tool = createResistanceTradeTool(source);
    const zero = JSON.parse((await tool.invoke({ league: 'Standard', total_budget: 0 })).content[0].text);
    expect(zero.searches).toEqual([]); expect(zero.effectivePerItemCap).toBe(0);
    for (const args of [{ league: 'Standard', slots: ['Unknown'] }, { league: 'Standard', resistance_minimums: { fire: -1 } }, { league: 'Standard', currency: 'chaos or divine' }, { league: 'Standard', extra: true }]) await expect(tool.invoke(args)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
