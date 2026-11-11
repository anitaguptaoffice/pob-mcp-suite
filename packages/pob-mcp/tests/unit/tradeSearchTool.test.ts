import { createTradeSearchTool } from '../../src/features/tradeSearch/tool.js';
import { handleSearchTradeItems } from '../../src/handlers/tradeHandlers.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const time = '2026-01-01T00:00:00.000Z';
const stats = { result: [{ entries: [{ id: 'explicit.life', text: '+# Life', type: 'explicit' }, { id: 'fractured.life', text: '+# Life', type: 'fractured' }] }] };

describe('new official trade search', () => {
  it('preserves filter groups, listing order, partial failures and source coverage without forwarding whisper tokens', async () => {
    let captured: TradeQuery | undefined;
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: stats }),
      search: async (league: string, query: TradeQuery) => { captured = query; return { source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 100, result: ['one', 'two', 'missing'], inexact: true } }; },
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { missingIds: ['missing'], listings: [
        { id: 'two', item: { name: 'Second', extended: { hashes: { fractured: [['fractured.life', [0]]] } } }, listing: { price: { amount: 2, currency: 'divine' }, account: { name: 'seller2' }, whisper_token: 'must-not-leak' } },
        { id: 'one', item: { name: 'First', extended: { hashes: { explicit: [['explicit.life', [0]]] } } }, listing: { price: { amount: 10, currency: 'chaos' }, account: { name: 'seller1' }, whisper_token: 'must-not-leak' } },
      ] } }),
    } as unknown as OfficialTradeSource;
    const response = await createTradeSearchTool(source).invoke({ league: 'Standard', item_type: 'Gold Ring', min_price: 1, max_price: 30, price_currency: 'chaos', limit: 3,
      stat_groups: [{ type: 'count', min: 1, filters: [{ stat_id: 'explicit.life', min: 50 }, { stat_id: 'fractured.life', min: 50 }] }] });
    const result = JSON.parse(response.content[0].text);
    expect(captured?.query.status?.option).toBe('securable');
    expect(captured?.query.filters?.trade_filters?.filters?.sale_type?.option).toBe('priced');
    expect(captured?.query.stats?.[0].type).toBe('count');
    expect(captured?.query.stats?.[0].filters.map(filter => filter.id)).toEqual(['explicit.life', 'fractured.life']);
    expect(result.listings.map((listing: { id: string }) => listing.id)).toEqual(['one', 'two']);
    expect(result.missingListingIds).toEqual(['missing']);
    expect(result.listingScope).toBe('instant_buyout');
    expect(result.searchId).toBe('q');
    expect(result.sourceStatistics.matchingListingsBySource).toMatchObject({ explicit: 1, fractured: 1 });
    expect(result.sourceTimes).toEqual({ stats: time, search: time, listings: time });
    expect(result.inexact).toBe(true);
    expect(response.content[0].text).not.toContain('must-not-leak');
  });

  it('matches the previous query on supported filters, adding an explicit priced constraint', async () => {
    const args = { league: 'Standard', item_type: 'Gold Ring', item_rarity: 'rare' as const, corrupted: false, identified: true,
      mods: [{ stat_id: 'explicit.life', min: 40 }], min_price: 2, max_price: 10, price_currency: 'chaos', sort: 'price_desc' as const };
    let previous: TradeQuery | undefined;
    await handleSearchTradeItems({ tradeClient: { getStats: async () => stats, searchItems: async (_league: string, query: TradeQuery) => { previous = query; return { id: 'q', total: 0, result: [] }; } } as any }, args);
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: stats }),
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 0, result: [] } }),
    } as unknown as OfficialTradeSource;
    const actual = JSON.parse((await createTradeSearchTool(source).invoke(args)).content[0].text);
    const expected = JSON.parse(JSON.stringify(previous));
    expected.query.filters.trade_filters.filters.sale_type = { option: 'priced' };
    expect(actual.query).toEqual(expected);
    expect(actual.fetchedCount).toBe(0);
  });

  it('rejects ambiguous options and invalid ranges before contacting the source', async () => {
    const source = { search: jest.fn() } as unknown as OfficialTradeSource;
    const tool = createTradeSearchTool(source);
    for (const args of [
      { league: 'Standard', online_only: true },
      { league: 'Standard', min_price: 10, max_price: 2 },
      { league: 'Standard', sale_type: 'unpriced' },
      { league: 'Standard', stat_groups: [{ type: 'count', min: 2, filters: [{ stat_id: 'x' }] }] },
      { league: 'Standard', mods: [{ stat_id: 'x', option: 'ignored' }] },
      { league: 'Standard', stat_groups: [{ type: 'and', filters: [{ stat_id: 'x' }], disabled: true }] },
      { league: 'Standard', stat_groups: [{ type: 'weight', min: 10, filters: [{ stat_id: 'x', min: 1 }] }] },
      { league: 'Standard', stat_groups: [{ type: 'weight', min: 10, filters: [{ stat_id: 'x' }] }] },
      { league: 'Standard', stat_groups: [{ type: 'and', filters: [{ stat_id: 'x', weight: 1 }] }] },
      { league: 'Standard', mods: [{ stat_id: 'x', weight: 1 }] },
    ]) await expect(tool.invoke(args)).rejects.toThrow();
    expect(source.search).not.toHaveBeenCalled();
  });

  it('sends explicit weighted-group weights and discloses optional count filters', async () => {
    let captured: TradeQuery | undefined;
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: stats }),
      search: async (league: string, query: TradeQuery) => { captured = query; return { source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 0, result: [] } }; },
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createTradeSearchTool(source).invoke({ league: 'Standard', stat_groups: [
      { type: 'weight', min: 50, filters: [{ stat_id: 'explicit.life', weight: 1.5 }, { stat_id: 'fractured.life', weight: -0.5 }] },
      { type: 'count', min: 0, filters: [{ stat_id: 'explicit.life', min: 40 }] },
    ] })).content[0].text);
    expect(captured?.query.stats?.[0]).toEqual({ type: 'weight', value: { min: 50, max: undefined }, filters: [
      { id: 'explicit.life', value: { weight: 1.5 } }, { id: 'fractured.life', value: { weight: -0.5 } },
    ] });
    expect(result.warnings.join(' ')).toContain('permits zero matches');
    expect(result.query.query.status.option).toBe('securable');
    expect(result.query.query.filters.trade_filters.filters.sale_type.option).toBe('priced');
  });

  it('distinguishes unavailable stat data from a completed audit', async () => {
    const source = {
      stats: async () => { throw Object.assign(new Error('offline'), { code: 'http', httpStatus: 503 }); },
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 0, result: [] } }),
    } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createTradeSearchTool(source).invoke({ league: 'Standard', mods: [{ stat_id: 'explicit.life', min: 1 }] })).content[0].text);
    expect(result.sourceAudit).toBe('unavailable');
    expect(result.sourceFailures).toEqual([{ operation: 'stats', message: 'offline', code: 'http', httpStatus: 503 }]);
    expect(result.sourceWarnings.join(' ')).toContain('could not be audited');
  });

  it('applies a currency-only filter and labels explicitly requested unpriced searches', async () => {
    const source = {
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 0, result: [] } }),
    } as unknown as OfficialTradeSource;
    const tool = createTradeSearchTool(source);
    const currency = JSON.parse((await tool.invoke({ league: 'Standard', price_currency: 'divine' })).content[0].text);
    expect(currency.query.query.filters.trade_filters.filters.price.option).toBe('divine');
    expect(currency.query.query.filters.trade_filters.filters.sale_type.option).toBe('priced');
    const unpriced = JSON.parse((await tool.invoke({ league: 'Standard', status: 'any', sale_type: 'unpriced' })).content[0].text);
    expect(unpriced.query.query.status.option).toBe('any');
    expect(unpriced.query.query.filters.trade_filters.filters.sale_type.option).toBe('unpriced');
    expect(unpriced.listingScope).toBe('other');
  });
});
