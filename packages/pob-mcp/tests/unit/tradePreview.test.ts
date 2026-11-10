import { createTradePreviewTool } from '../../src/features/tradePreview/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';

const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const snapshotId = 'f'.repeat(64);
const text = 'Item Class: Rings\nRarity: Rare\nExample Ring\nGold Ring\n--------\n+50 to maximum Life';
const listing = (id: string, league = 'Standard') => ({ id, item: { league, identified: true, verified: true, name: 'Example Ring', typeLine: 'Gold Ring', extended: { text: Buffer.from(text).toString('base64') } }, listing: { price: { amount: 2, currency: 'chaos', type: '~price' } } });
const params = { snapshot_id: snapshotId, league: 'Standard', slot: 'Ring 1', search_id: 'query', item_ids: ids };

describe('snapshot trade listing previews', () => {
  it('uses the exact clipboard text and reports missing and mismatched listings individually', async () => {
    const trade = { fetchListings: jest.fn(async () => ({ source: 'official-trade', fetchedAt: '2026-01-01T00:00:00.000Z', request: { ids, queryId: 'query' }, data: { listings: [listing(ids[2], 'Hardcore'), listing(ids[0])], missingIds: [ids[1]] } })) } as unknown as OfficialTradeSource;
    const previewItem = jest.fn(async () => ({ snapshotId, baseline: { Life: 100 }, candidateStats: { Life: 150 }, delta: { Life: 50 } }));
    const tool = createTradePreviewTool({ previewItem, readSnapshot: async () => ({ id: snapshotId }) } as unknown as Pick<BuildFoundation, 'previewItem' | 'readSnapshot'>, trade);
    const result = JSON.parse((await tool.invoke(params)).content[0].text);
    expect(previewItem).toHaveBeenCalledTimes(1); expect(previewItem).toHaveBeenCalledWith(snapshotId, 'Ring 1', text);
    expect(result.fetchedAt).toBe('2026-01-01T00:00:00.000Z'); expect(result.completedCount).toBe(1);
    expect(result.results[0]).toMatchObject({ itemId: ids[0], status: 'ok', clipboardText: text, price: { amount: 2, currency: 'chaos' }, preview: { delta: { Life: 50 } } });
    expect(result.results[1]).toMatchObject({ itemId: ids[1], status: 'error', error: 'Trade listing is missing' });
    expect(result.results[2].error).toContain('league');
  });
  it('rejects mismatched fetch provenance and invalid inputs before preview', async () => {
    const trade = { fetchListings: jest.fn(async () => ({ source: 'official-trade', fetchedAt: '2026-01-01T00:00:00.000Z', request: { ids, queryId: 'wrong' }, data: { listings: [], missingIds: ids } })) } as unknown as OfficialTradeSource;
    const previewItem = jest.fn();
    const tool = createTradePreviewTool({ previewItem, readSnapshot: async () => ({ id: snapshotId }) } as unknown as Pick<BuildFoundation, 'previewItem' | 'readSnapshot'>, trade);
    await expect(tool.invoke(params)).rejects.toThrow('provenance');
    await expect(tool.invoke({ ...params, item_ids: [ids[0], ids[0]] })).rejects.toThrow('distinct');
    expect(previewItem).not.toHaveBeenCalled();
  });
  it('does not contact Trade for a missing snapshot', async () => {
    const fetchListings = jest.fn();
    const tool = createTradePreviewTool({ previewItem: jest.fn(), readSnapshot: async () => { throw new Error('snapshot unavailable'); } } as unknown as Pick<BuildFoundation, 'previewItem' | 'readSnapshot'>, { fetchListings } as unknown as OfficialTradeSource);
    await expect(tool.invoke(params)).rejects.toThrow('snapshot unavailable');
    expect(fetchListings).not.toHaveBeenCalled();
  });
});
