import { describe, expect, it, jest } from '@jest/globals';
import { compareTradeListings } from '../../src/features/itemComparison/tradeBatch';

const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const text = 'Item Class: Amulets\nRarity: Rare\nTest Item\nCitrine Amulet\n--------\n+20 to maximum Life\n';
const listing = (id: string, valid = true) => ({ id, item: { league: 'League', identified: true, verified: true, name: 'Test Item', typeLine: 'Citrine Amulet', extended: { text: valid ? Buffer.from(text).toString('base64') : '' } }, listing: { price: { amount: id === ids[0] ? 1 : 5, currency: id === ids[0] ? 'divine' : 'chaos' } } } as any);

describe('batch trade item comparison', () => {
  it('fetches once, processes in requested order, preserves currencies and reports partial failure', async () => {
    const fetchItems = jest.fn(async () => [listing(ids[2]), listing(ids[1], false), listing(ids[0])]);
    let calls = 0;
    const compareItem = jest.fn(async () => ({ slot: 'Amulet', candidate: { name: 'Test Item' }, baseline: { Life: 100 }, candidateStats: { Life: 100 + ++calls } }));
    const report = await compareTradeListings({ fetchItems }, { compareItem }, { league: 'League', slot: 'Amulet', item_ids: ids, search_id: 'q' });
    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(fetchItems).toHaveBeenCalledWith(ids, 'q');
    expect(compareItem).toHaveBeenCalledTimes(2);
    expect(report.completedCount).toBe(2);
    expect(report.baselineStatsMatch).toBe(true);
    expect(report.results.map(item => [item.itemId, item.status])).toEqual([[ids[0], 'ok'], [ids[1], 'error'], [ids[2], 'ok']]);
    expect(report.results[0].status === 'ok' && report.results[0].result.price?.currency).toBe('divine');
    expect(report.results[2].status === 'ok' && report.results[2].result.price?.currency).toBe('chaos');
  });

  it('flags differing baseline stats without asserting that matching stats prove identical state', async () => {
    const fetchItems = async () => [listing(ids[0]), listing(ids[1])];
    let life = 100;
    const compareItem = async () => ({ slot: 'Amulet', candidate: {}, baseline: { Life: life++ }, candidateStats: { Life: 120 } });
    const report = await compareTradeListings({ fetchItems }, { compareItem }, { league: 'League', slot: 'Amulet', item_ids: ids.slice(0, 2), search_id: 'q' });
    expect(report.baselineStatsMatch).toBe(false);
    expect(report.warnings.join(' ')).toContain('Baseline stats changed');
  });

  it('refuses duplicate and oversized requests before fetching', async () => {
    const fetchItems = jest.fn();
    const trade = { fetchItems } as any;
    const client = { compareItem: jest.fn() } as any;
    await expect(compareTradeListings(trade, client, { league: 'League', slot: 'Amulet', item_ids: [ids[0], ids[0]], search_id: 'q' })).rejects.toThrow();
    await expect(compareTradeListings(trade, client, { league: 'League', slot: 'Amulet', item_ids: Array(6).fill(ids[0]), search_id: 'q' })).rejects.toThrow();
    expect(fetchItems).not.toHaveBeenCalled();
  });
});
