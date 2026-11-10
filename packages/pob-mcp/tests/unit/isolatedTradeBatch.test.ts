import { describe, expect, it, jest } from '@jest/globals';
import { compareTradeListingsSnapshot } from '../../src/features/itemComparison/isolatedTradeBatch';

const id = 'a'.repeat(64);
const raw = 'Item Class: Amulets\nRarity: Rare\nTest Item\nCitrine Amulet\n--------\n+20 to maximum Life\n';
const listing = { id, item: { league: 'League', identified: true, verified: true, name: 'Test Item', typeLine: 'Citrine Amulet', extended: { text: Buffer.from(raw).toString('base64') } }, listing: { price: { amount: 1, currency: 'chaos' } } } as any;
const args = { league: 'League', slot: 'Amulet', item_ids: [id], search_id: 'q' };

describe('isolated trade batch', () => {
  it('uses a captured snapshot and closes the isolated engine', async () => {
    const snapshot = jest.fn(async () => ({ xml: '<build>unsaved state</build>', baseline: { Life: 100, CombinedDPS: 200 } }));
    const loadBuildXml = jest.fn(async () => ({ ok: true as const }));
    const compareItem = jest.fn(async () => ({ slot: 'Amulet', candidate: {}, baseline: { Life: 100, CombinedDPS: 200 }, candidateStats: { Life: 120 } }));
    const close = jest.fn(async () => {});
    const report = await compareTradeListingsSnapshot({ fetchItems: async () => [listing] }, { live: { itemComparisonSnapshot: snapshot }, createIsolated: async () => ({ client: { loadBuildXml, compareItem }, close }) }, args);
    expect(loadBuildXml).toHaveBeenCalledWith('<build>unsaved state</build>', 'item-comparison-snapshot');
    expect(report.source).toBe('live_snapshot_isolated_pob');
    expect(report.completedCount).toBe(1);
    expect(report.results[0].status === 'ok' && report.results[0].result.source).toBe('live_snapshot_isolated_pob');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('discards mismatched baseline results and closes on failure', async () => {
    const close = jest.fn(async () => {});
    const isolated = { loadBuildXml: async () => ({ ok: true as const }), compareItem: async () => ({ slot: 'Amulet', candidate: {}, baseline: { Life: 101 }, candidateStats: { Life: 120 } }) };
    const report = await compareTradeListingsSnapshot({ fetchItems: async () => [listing] }, { live: { itemComparisonSnapshot: async () => ({ xml: '<build/>', baseline: { Life: 100 } }) }, createIsolated: async () => ({ client: isolated, close }) }, args);
    expect(report.completedCount).toBe(0);
    expect(report.snapshotBaselineMismatchCount).toBe(1);
    expect(report.results[0].status).toBe('error');
    expect(close).toHaveBeenCalledTimes(1);
    await expect(compareTradeListingsSnapshot({ fetchItems: async () => { throw new Error('network'); } }, { live: { itemComparisonSnapshot: async () => ({ xml: '<build/>', baseline: { Life: 100 } }) }, createIsolated: async () => ({ client: isolated, close }) }, args)).rejects.toThrow('network');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid arguments without creating an engine', async () => {
    const snapshot = jest.fn();
    const createIsolated = jest.fn();
    await expect(compareTradeListingsSnapshot({ fetchItems: jest.fn() } as any, { live: { itemComparisonSnapshot: snapshot }, createIsolated } as any, { ...args, item_ids: [] })).rejects.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
    expect(createIsolated).not.toHaveBeenCalled();
  });
});
