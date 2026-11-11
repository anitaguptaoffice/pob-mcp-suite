import { createSourceComparableTool } from '../../src/features/tradeComparable/sourceTool.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import type { ItemListing, StatData, TradeQuery } from '../../src/types/tradeTypes.js';

const time = '2026-01-01T00:00:00.000Z';
const args = { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [{ type: 'and', filters: [{ stat_id: 'explicit.stat_1', min: 50 }] }] };

describe('source-backed comparable pricing', () => {
  it('keeps the securable priced query, source coverage, partial listings and original timestamps', async () => {
    let sent: TradeQuery | undefined;
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: { result: [{ entries: [
        { id: 'explicit.stat_1', text: '+# Life', type: 'explicit' }, { id: 'fractured.stat_1', text: '+# Life', type: 'fractured' },
      ] }] } as StatData }),
      search: async (league: string, query: TradeQuery) => { sent = query; return { source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q1', total: 2, result: ['one', 'two'], complexity: 1 } }; },
      fetchListings: async (ids: string[], queryId: string) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [
        { id: 'one', item: { league: 'Standard', verified: true, extended: { hashes: { explicit: [['explicit.stat_1', [0]]] } } }, listing: { price: { type: '~b/o', amount: 4, currency: 'chaos' } } },
      ] as unknown as ItemListing[], missingIds: ['two'] } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createSourceComparableTool(source).invoke(args)).content[0].text);
    expect(sent?.query.status?.option).toBe('securable');
    expect(sent?.query.filters?.trade_filters?.filters?.sale_type?.option).toBe('priced');
    expect(report.listingScope).toBe('instant_buyout');
    expect(report.byCurrency).toEqual([{ currency: 'chaos', sampleCount: 1, min: 4, median: 4, max: 4 }]);
    expect(report.missingListingIds).toEqual(['two']);
    expect(report.sourceTimes).toEqual({ stats: time, search: time, listings: time });
    expect(report.sourceWarnings.join(' ')).toContain('fractured');
    expect(report.sourceStatistics.matchingListingsBySource.explicit).toBe(1);
    expect(report.warnings.join(' ')).toContain('partial');
  });

  it('reports unavailable source auditing rather than inferring missing sources', async () => {
    const source = {
      stats: async () => { throw Object.assign(new Error('unavailable'), { code: 'http', httpStatus: 503 }); },
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'q', total: 0, result: [] } }),
    } as unknown as OfficialTradeSource;
    const report = JSON.parse((await createSourceComparableTool(source).invoke(args)).content[0].text);
    expect(report.sourceWarnings.join(' ')).toContain('source coverage could not be audited');
    expect(report.sourceFailures).toEqual([{ operation: 'stats', message: 'unavailable', code: 'http', httpStatus: 503 }]);
    expect(report.sourceTimes).toEqual({ search: time });
    expect(report.byCurrency).toEqual([]);
  });

  it('rejects mismatched query provenance instead of reporting a broadened search', async () => {
    const source = {
      stats: async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: { result: [] } }),
      search: async (league: string, query: TradeQuery) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: { ...query, query: { ...query.query, status: { option: 'available' } } } }, data: { id: 'q', total: 0, result: [] } }),
    } as unknown as OfficialTradeSource;
    await expect(createSourceComparableTool(source).invoke(args)).rejects.toThrow('mismatched search provenance');
  });
});
