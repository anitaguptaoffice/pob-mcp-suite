import { describe, expect, it, jest } from '@jest/globals';
import { estimateComparable } from '../../src/features/tradeComparable/tool.js';
import type { TradeApiClient } from '../../src/services/tradeClient.js';

describe('comparable trade prices', () => {
  it('preserves user-confirmed source groups and separates currencies', async () => {
    const searchItems = jest.fn(async () => ({ id: 'abc', complexity: 1, total: 20, result: ['1', '2', '3'] }));
    const fetchItems = jest.fn(async () => [
      { listing: { price: { amount: 3, currency: 'chaos' } } },
      { listing: { price: { amount: 7, currency: 'chaos' } } },
      { listing: { price: { amount: 1, currency: 'divine' } } },
    ]);
    const client = { searchItems, fetchItems } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems'>;
    const report = await estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [
      { type: 'count', min: 1, filters: [{ stat_id: 'explicit.stat_1', min: 50 }, { stat_id: 'fractured.stat_1', min: 50 }] },
    ] });
    expect(report.query.query.type).toBe('Hubris Circlet');
    expect(report.query.query.stats?.[0].type).toBe('count');
    expect(report.query.query.stats?.[0].filters).toHaveLength(2);
    expect(report.byCurrency).toEqual([
      { currency: 'chaos', sampleCount: 2, min: 3, median: 5, max: 7 },
      { currency: 'divine', sampleCount: 1, min: 1, median: 1, max: 1 },
    ]);
    expect(report.totalMatches).toBe(20);
    expect(report.searchUrl).toContain('/Standard/abc');
    expect(report.searchId).toBe('abc');
    expect(report.warnings.join(' ')).toContain('may be cached');
  });

  it('audits source coverage and counts exact matching sources only when hashes are available', async () => {
    const client = {
      getStats: async () => ({ result: [{ entries: [
        { id: 'explicit.stat_1', text: '+# Life', type: 'explicit' },
        { id: 'fractured.stat_1', text: '+# Life', type: 'fractured' },
      ] }] }),
      searchItems: async () => ({ id: 'abc', complexity: 1, total: 3, result: ['1', '2', '3'] }),
      fetchItems: async () => [
        { item: { extended: { hashes: { explicit: [['explicit.stat_1', [0]]], fractured: [['fractured.stat_1', [0]]] } } }, listing: {} },
        { item: { extended: { hashes: { explicit: [['explicit.unrelated', [0]]] } } }, listing: {} },
        { item: {}, listing: {} },
      ],
    } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems' | 'getStats'>;
    const report = await estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [
      { type: 'and', filters: [{ stat_id: 'explicit.stat_1', min: 50 }] },
    ] });
    expect(report.query.query.status?.option).toBe('securable');
    expect(report.sourceWarnings.join(' ')).toContain('fractured');
    expect(report.sourceStatistics).toMatchObject({ sampleCount: 3, inspectableCount: 2, unavailableCount: 1,
      matchingListingsBySource: { explicit: 1, implicit: 0, fractured: 0, crafted: 0, enchant: 0 },
      listingsContainingSource: { explicit: 2, implicit: 0, fractured: 1, crafted: 0, enchant: 0 },
      byRequestedStat: [{ statId: 'explicit.stat_1', hashComparable: true, matchingListingsBySource: { explicit: 1, implicit: 0, fractured: 0, crafted: 0, enchant: 0 } }] });
  });

  it('reports an unavailable source audit instead of claiming complete coverage', async () => {
    const client = { getStats: async () => { throw new Error('network'); },
      searchItems: async () => ({ id: 'abc', total: 0, result: [] }), fetchItems: async () => []
    } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems' | 'getStats'>;
    const report = await estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [
      { type: 'and', filters: [{ stat_id: 'explicit.stat_1', min: 50 }] },
    ] });
    expect(report.sourceWarnings.join(' ')).toContain('source coverage could not be audited');
  });

  it('refuses an unspecified search instead of pricing unrelated items', async () => {
    const client = { searchItems: jest.fn(), fetchItems: jest.fn() } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems'>;
    await expect(estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [] })).rejects.toThrow();
    expect(client.searchItems).not.toHaveBeenCalled();
  });

  it('discloses inexact trade searches even when results are returned', async () => {
    const client = { searchItems: async () => ({ id: 'abc', complexity: 1, total: 0, result: [], inexact: true }), fetchItems: async () => [] } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems'>;
    const report = await estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [{ type: 'and', filters: [{ stat_id: 'explicit.stat_1', min: 50 }] }] });
    expect(report.inexact).toBe(true);
    expect(report.warnings.join(' ')).toContain('inexact');
  });

  it('rejects impossible or contradictory count groups before calling trade', async () => {
    const client = { searchItems: jest.fn(), fetchItems: jest.fn() } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems'>;
    for (const group of [
      { type: 'count', min: 2, filters: [{ stat_id: 'explicit.a' }] },
      { type: 'count', min: 0.5, filters: [{ stat_id: 'explicit.a' }] },
      { type: 'count', min: 1, max: 0, filters: [{ stat_id: 'explicit.a' }] },
    ]) {
      await expect(estimateComparable(client, { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [group] })).rejects.toThrow('invalid stat_groups');
    }
    expect(client.searchItems).not.toHaveBeenCalled();
  });

  it('rejects unsupported constraints and invalid limits instead of silently broadening a search', async () => {
    const client = { searchItems: jest.fn(), fetchItems: jest.fn() } as unknown as Pick<TradeApiClient, 'searchItems' | 'fetchItems'>;
    const valid = { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [{ type: 'and', filters: [{ stat_id: 'explicit.a' }] }] };
    await expect(estimateComparable(client, { ...valid, status: 'any' })).rejects.toThrow('unsupported');
    await expect(estimateComparable(client, { ...valid, limit: 11 })).rejects.toThrow('limit');
    await expect(estimateComparable(client, { ...valid, stat_groups: [{ type: 'and', filters: [{ stat_id: 'explicit.a', option: 'ignored' }] }] })).rejects.toThrow('invalid stat_groups');
    expect(client.searchItems).not.toHaveBeenCalled();
  });
});
