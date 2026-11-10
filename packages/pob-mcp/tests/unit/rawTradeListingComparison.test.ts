import { createTradeListingComparisonTool } from '../../src/features/tradeListingComparison/tool.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const listing = (id: string, league: string, amount: number, currency: string) => ({ id, item: { id, league, verified: true, name: 'Example', typeLine: 'Gold Ring', explicitMods: ['+50 to maximum Life'] }, listing: { price: { amount, currency, type: '~b/o' }, account: { name: 'seller' } } });
const response = { source: 'official-trade', fetchedAt: '2026-01-01T00:00:00.000Z', request: { ids, queryId: 'query' }, data: { listings: [listing(ids[2], 'Hardcore', 3, 'divine'), listing(ids[0], 'Standard', 8, 'chaos')], missingIds: [ids[1]] } };
const args = { league: 'Standard', search_id: 'query', item_ids: ids };
const make = (body: unknown = response) => {
  const fetchListings = jest.fn().mockResolvedValue(body);
  return { fetchListings, tool: createTradeListingComparisonTool({ fetchListings } as unknown as OfficialTradeSource) };
};
describe('raw official listing comparison', () => {
  it('preserves source time, currency, modifiers and individual missing or mismatched entries', async () => {
    const { tool, fetchListings } = make();
    const result = JSON.parse((await tool.invoke(args)).content[0].text);
    expect(fetchListings).toHaveBeenCalledWith(ids, 'query');
    expect(result.fetchedAt).toBe(response.fetchedAt); expect(result.listingScope).toBe('unknown');
    expect(result.results[0]).toMatchObject({ itemId: ids[0], status: 'ok', leagueStatus: 'match', price: { amount: 8, currency: 'chaos', type: '~b/o' }, item: { explicitMods: ['+50 to maximum Life'] }, seller: { online: null } });
    expect(result.results[1]).toEqual({ itemId: ids[1], status: 'missing' });
    expect(result.results[2]).toMatchObject({ itemId: ids[2], status: 'league_mismatch', listingLeague: 'Hardcore', price: { amount: 3, currency: 'divine' } });
    expect(result.warnings.join(' ')).toContain('do not establish securable');
  });
  it('supports missing search ID and does not fabricate URLs or prices', async () => {
    const noPrice = { id: ids[0], item: { league: 'Standard' }, listing: {} };
    const { tool } = make({ ...response, request: { ids: [ids[0]], queryId: null }, data: { listings: [noPrice], missingIds: [] } });
    const result = JSON.parse((await tool.invoke({ league: 'Standard', item_ids: [ids[0].toUpperCase()] })).content[0].text);
    expect(result.searchUrl).toBeNull(); expect(result.results[0].price).toBeNull();
  });
  it('rejects inconsistent provenance, duplicate results and invalid arguments', async () => {
    const bad = make({ ...response, request: { ids, queryId: 'other' } });
    await expect(bad.tool.invoke(args)).rejects.toThrow('provenance');
    const duplicate = make({ ...response, data: { listings: [listing(ids[0], 'Standard', 1, 'chaos'), listing(ids[0], 'Standard', 2, 'chaos')], missingIds: [ids[1], ids[2]] } });
    await expect(duplicate.tool.invoke(args)).rejects.toThrow('inconsistent listings');
    const wrongItem = listing(ids[0], 'Standard', 1, 'chaos'); wrongItem.item.id = ids[1];
    const mismatch = make({ ...response, data: { listings: [wrongItem], missingIds: [ids[1], ids[2]] } });
    await expect(mismatch.tool.invoke(args)).rejects.toThrow('inconsistent listings');
    const { tool, fetchListings } = make();
    await expect(tool.invoke({ ...args, item_ids: [ids[0], ids[0].toUpperCase()] })).rejects.toThrow('distinct');
    await expect(tool.invoke({ ...args, league: '' })).rejects.toThrow('league');
    expect(fetchListings).not.toHaveBeenCalled();
  });
});
