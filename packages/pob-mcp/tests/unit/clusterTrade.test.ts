import { createClusterTradeTool } from '../../src/features/clusterTrade/tool.js';
import { handleSearchClusterJewels } from '../../src/handlers/clusterJewelHandlers.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const at = '2026-01-01T00:00:00.000Z';
const ids = Array.from({ length: 23 }, (_, i) => `id${i}`);
const listing = (id: string, notable: string, currency = 'chaos') => ({ id, item: { league: 'Standard', verified: true, typeLine: 'Large Cluster Jewel', enchantMods: ['Adds 8 Passive Skills', 'Added Small Passive Skills grant: 10% increased Fire Damage'], explicitMods: [`1 Added Passive Skill is ${notable}`] }, listing: { price: { type: '~b/o', amount: 5, currency }, whisper_token: 'secret' } });

describe('cluster trade workflow', () => {
  it('matches legacy search filters, checks exact notables and reports bounded, partial sample provenance', async () => {
    let previous: TradeQuery | undefined, actual: TradeQuery | undefined;
    await handleSearchClusterJewels({ tradeClient: { searchItems: async (_league: string, query: TradeQuery) => { previous = query; return { id: 'q', total: 0, result: [] }; } } as any }, { league: 'Standard', jewel_size: 'large', passive_count: 8, min_item_level: 84, max_price: 10, notables: ['Prismatic Heart'], limit: 5 });
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: at, request: { kind: 'stats' }, data: { result: [{ entries: [] }] } }),
      search: async (league: string, query: TradeQuery) => { actual = query; return { source: 'official-trade', fetchedAt: at, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 100, result: ids, inexact: true } }; },
      fetchListings: async (requested: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids: requested, queryId }, data: { missingIds: requested.filter(id => id !== 'id0' && id !== 'id1' && id !== 'id2'), listings: [listing('id0', 'Prismatic Heart'), listing('id1', 'Prismatic Heartbeat'), listing('id2', 'Prismatic Heart', 'divine')].filter(item => requested.includes(item.id)) } }),
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createClusterTradeTool(source).invoke({ league: 'Standard', jewel_size: 'large', passive_count: 8, min_item_level: 84, max_price: 10, enchant: 'Fire Damage', notables: ['Prismatic Heart'], limit: 5 })).content[0].text);
    const expected = JSON.parse(JSON.stringify(previous)); expected.query.filters.trade_filters.filters.sale_type = { option: 'priced' };
    expect(actual).toEqual(expected);
    expect(result).toMatchObject({ listingScope: 'instant_buyout', requestedCount: 15, fetchedCount: 3, matchedCount: 1, returnedCount: 1, inexact: true, excludedPriceCount: 1 });
    expect(result.priceEvidenceCounts.explicit_buyout).toBe(3); expect(result.excludedBudgetCount).toBe(1);
    expect(result.fetches.map((entry: { ids: string[] }) => entry.ids.length)).toEqual([10, 5]);
    expect(result.fetches.every((entry: { fetchedAt: string }) => entry.fetchedAt === at)).toBe(true);
    expect(result.listings.map((entry: { id: string }) => entry.id)).toEqual(['id0']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('stops subsequent batches on rate limiting without reporting unexamined items as misses', async () => {
    const fetchListings = jest.fn(async () => { throw Object.assign(new Error('cooldown'), { code: 'rate-limit', httpStatus: 429 }); });
    const source = { search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: at, request: { league, query }, data: { id: 'q', total: ids.length, result: ids } }), fetchListings } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createClusterTradeTool(source).invoke({ league: 'Standard', jewel_size: 'large', limit: 10 })).content[0].text);
    expect(fetchListings).toHaveBeenCalledTimes(1); expect(result.notAttemptedIds).toEqual(ids.slice(10));
    expect(result.fetches[0]).toMatchObject({ error: 'cooldown', code: 'rate-limit', httpStatus: 429 }); expect(result.missingListingIds).toEqual([]);
  });
  it('excludes unconfirmed buyouts, unverified items and wrong leagues from cluster candidates', async () => {
    const good = listing('id0', 'X'), negotiated = listing('id1', 'X'), unverified = listing('id2', 'X'), wrongLeague = listing('id3', 'X');
    negotiated.listing.price.type = '~price'; unverified.item.verified = false; wrongLeague.item.league = 'Other';
    const listings = [good, negotiated, unverified, wrongLeague];
    const source = { search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: at, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 4, result: listings.map(item => item.id) } }),
      fetchListings: async (requested: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids: requested, queryId }, data: { listings, missingIds: [] } }) } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createClusterTradeTool(source).invoke({ league: 'Standard', jewel_size: 'large', limit: 2 })).content[0].text);
    expect(result.listings.map((item: { id: string }) => item.id)).toEqual(['id0']);
    expect(result.priceEvidenceCounts).toEqual({ explicit_buyout: 1, invalid_price: 0, unconfirmed_buyout: 1, unverified_item: 1, league_unconfirmed: 1 });
    expect(result.sourceStatistics.sampleCount).toBe(4);
  });
  it('rejects bad options without contacting the source', async () => {
    const search = jest.fn(); const tool = createClusterTradeTool({ search } as unknown as OfficialTradeSource);
    for (const args of [{ league: 'Standard', jewel_size: 'huge' }, { league: 'Standard', jewel_size: 'large', passive_count: 0 }, { league: 'Standard', jewel_size: 'large', notables: ['X', ' x '] }, { league: 'Standard', jewel_size: 'large', online_only: false }]) await expect(tool.invoke(args)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
  it('excludes listings without an actual positive price even without a price ceiling', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: at, request: { league, query }, data: { id: 'q', total: 1, result: ['id0'] } }),
      fetchListings: async (requested: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids: requested, queryId }, data: { missingIds: [], listings: [{ id: 'id0', item: { league: 'Standard', typeLine: 'Large Cluster Jewel' }, listing: {} }] } }),
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createClusterTradeTool(source).invoke({ league: 'Standard', jewel_size: 'large' })).content[0].text);
    expect(result.excludedPriceCount).toBe(1); expect(result.listings).toEqual([]);
  });
  it('honors an explicit currency filter even without a maximum price', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: at, request: { league, query }, data: { id: 'q', total: 2, result: ['id0', 'id1'] } }),
      fetchListings: async (requested: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: at, request: { ids: requested, queryId }, data: { missingIds: [], listings: [listing('id0', 'X'), listing('id1', 'X', 'divine')] } }),
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createClusterTradeTool(source).invoke({ league: 'Standard', jewel_size: 'large', price_currency: 'chaos' })).content[0].text);
    expect(result.query.query.filters.trade_filters.filters.price.option).toBe('chaos');
    expect(result.listings.map((item: { id: string }) => item.id)).toEqual(['id0']); expect(result.excludedPriceCount).toBe(1);
  });
});
