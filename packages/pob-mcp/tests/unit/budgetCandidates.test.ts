import { createBudgetCandidatesTool } from '../../src/features/budgetCandidates/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';

const snapshotId = 'a'.repeat(64), itemId = 'b'.repeat(64), time = '2026-01-01T00:00:00.000Z';
const itemText = 'Item Class: Rings\nRarity: Rare\nExample\nGold Ring\n+50 to maximum Life';
function fixture(price = { type: '~b/o', amount: 5, currency: 'chaos' }) {
  const previewItem = jest.fn(async () => ({ snapshotId, baseline: { Life: 100 }, candidateStats: { Life: 150 }, delta: { Life: 50 } }));
  const foundation = { readSnapshot: async () => ({ id: snapshotId }), previewItem } as unknown as BuildFoundation;
  const search = jest.fn(async (league, query) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: 'search-id', result: [itemId], total: 1 } }));
  const fetchListings = jest.fn(async (ids, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [{ id: itemId, item: { id: itemId, league: 'Standard', identified: true, verified: true, typeLine: 'Gold Ring', name: 'Example', extended: { text: Buffer.from(itemText).toString('base64') } }, listing: { price } }], missingIds: [] } }));
  const source = { search, fetchListings } as unknown as OfficialTradeSource;
  return { foundation, previewItem, source, search, fetchListings, tool: createBudgetCandidatesTool(foundation, source) };
}
const args = { snapshot_id: snapshotId, league: 'Standard', budget_chaos: 10, searches: [{ slot: 'Ring 1', item_type: 'Gold Ring', max_price: 20 }] };

it('enforces the total chaos cap and previews an exact official buyout candidate', async () => {
  const f = fixture(), result = JSON.parse((await f.tool.invoke(args)).content[0].text);
  const search = result.searches[0], query = search.query.query;
  expect(query.status.option).toBe('securable'); expect(query.filters.trade_filters.filters.sale_type.option).toBe('priced');
  expect(query.filters.trade_filters.filters.price).toMatchObject({ max: 10, option: 'chaos' });
  expect(search.candidates[0]).toMatchObject({ itemId, priceEvidence: 'explicit_buyout', listingVerified: true, status: 'previewed', preview: { delta: { Life: 50 } } });
  expect(f.previewItem).toHaveBeenCalledWith(snapshotId, 'Ring 1', itemText);
  expect(result.complete).toBe(false); expect(result.combinedCost).toBeNull();
  expect(search.sourceTimes).toMatchObject({ search: time, listings: time });
});

it('does not convert foreign currencies or label negotiated prices as buyouts', async () => {
  const foreign = fixture({ type: '~b/o', amount: 1, currency: 'divine' });
  const result = JSON.parse((await foreign.tool.invoke(args)).content[0].text);
  expect(result.searches[0].candidates[0]).toMatchObject({ status: 'unavailable', priceEvidence: 'outside_budget_or_unknown' });
  expect(foreign.previewItem).not.toHaveBeenCalled();
  const negotiated = fixture({ type: '~price', amount: 1, currency: 'chaos' });
  const next = JSON.parse((await negotiated.tool.invoke(args)).content[0].text);
  expect(next.searches[0].candidates[0]).toMatchObject({ priceEvidence: 'price_type_unconfirmed', listingEvidence: 'unconfirmed_buyout', status: 'unavailable' });
  expect(negotiated.previewItem).not.toHaveBeenCalled();
});

it('preserves both direct modifiers and grouped modifier conditions in the market query', async () => {
  const f = fixture();
  const result = JSON.parse((await f.tool.invoke({ ...args, searches: [{
    slot: 'Ring 1', item_type: 'Gold Ring',
    mods: [{ stat_id: 'explicit.stat_1', min: 50 }],
    stat_groups: [{ type: 'or', filters: [{ stat_id: 'explicit.stat_2', min: 20 }, { stat_id: 'fractured.stat_2', min: 20 }] }],
  }] })).content[0].text);
  expect(result.searches[0].query.query.stats).toMatchObject([
    { type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 50 } }] },
    { type: 'or', filters: [{ id: 'explicit.stat_2', value: { min: 20 } }, { id: 'fractured.stat_2', value: { min: 20 } }] },
  ]);
});

it('does not preview unverified or wrong-league items despite a fixed price', async () => {
  for (const [verified, league, expected, reported] of [[false, 'Standard', 'unverified_item', false], [undefined, 'Standard', 'unverified_item', null], [true, 'Other', 'league_unconfirmed', true]] as const) {
    const f = fixture();
    f.fetchListings.mockImplementationOnce(async (ids, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [{ id: itemId, item: { id: itemId, league, identified: true, verified: verified as boolean, typeLine: 'Gold Ring', name: 'Example', extended: { text: Buffer.from(itemText).toString('base64') } }, listing: { price: { type: '~b/o', amount: 5, currency: 'chaos' } } }], missingIds: [] } }));
    const result = JSON.parse((await f.tool.invoke(args)).content[0].text);
    expect(result.searches[0].candidates[0]).toMatchObject({ status: 'unavailable', listingEvidence: expected, listingVerified: reported });
    expect(f.previewItem).not.toHaveBeenCalled();
  }
});

it('stops further searches after a rate limit and validates all input first', async () => {
  const f = fixture();
  f.search.mockImplementationOnce(async () => { throw Object.assign(new Error('rate limit'), { code: 'rate-limit', httpStatus: 429 }); });
  const result = JSON.parse((await f.tool.invoke({ ...args, searches: [{ slot: 'Ring 1', item_type: 'Gold Ring' }, { slot: 'Ring 2', item_type: 'Gold Ring' }] })).content[0].text);
  expect(result.searches.map((entry: any) => entry.status)).toEqual(['error', 'not_attempted']); expect(f.search).toHaveBeenCalledTimes(1);
  await expect(f.tool.invoke({ ...args, searches: [{ slot: 'Ring 1', item_type: 'Gold Ring' }, { slot: 'Ring 1', item_type: 'Gold Ring' }] })).rejects.toThrow('distinct');
  expect(f.search).toHaveBeenCalledTimes(1);
});

it('refuses mismatched listing identities from the source', async () => {
  const f = fixture();
  f.fetchListings.mockImplementationOnce(async (ids, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [{ id: itemId, item: { id: 'c'.repeat(64), league: 'Standard', identified: true, verified: true, typeLine: 'Gold Ring', name: 'Example', extended: { text: Buffer.from(itemText).toString('base64') } }, listing: { price: { type: '~b/o', amount: 5, currency: 'chaos' } } }], missingIds: [] } }));
  const result = JSON.parse((await f.tool.invoke(args)).content[0].text);
  expect(result.searches[0]).toMatchObject({ status: 'error', error: expect.stringContaining('inconsistent listings') });
  expect(f.previewItem).not.toHaveBeenCalled();
});

it('treats a zero budget as a valid request without contacting the market', async () => {
  const f = fixture();
  const result = JSON.parse((await f.tool.invoke({ ...args, budget_chaos: 0 })).content[0].text);
  expect(result.searches[0].status).toBe('not_attempted'); expect(f.search).not.toHaveBeenCalled(); expect(f.previewItem).not.toHaveBeenCalled();
});
