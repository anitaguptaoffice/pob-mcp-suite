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
    expect(report.warnings.join(' ')).toContain('可能来自缓存');
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
    expect(report.warnings.join(' ')).toContain('近似匹配');
  });
});
