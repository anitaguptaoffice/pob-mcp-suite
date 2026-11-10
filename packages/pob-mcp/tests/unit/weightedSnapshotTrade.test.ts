import { createWeightedTradeTools } from '../../src/features/weightedTrade/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';
import { auditWeightedSources } from '../../src/features/weightedTrade/sourceAudit.js';

const snapshotId = 'a'.repeat(64), itemId = 'b'.repeat(64), missingId = 'c'.repeat(64), time = '2026-01-01T00:00:00.000Z';
const args = { snapshot_id: snapshotId, slot: 'Amulet', weights: [{ stat: 'MinionCombinedDPS', weight: 1 }], max_price: 30, price_currency: 'chaos' };
function fixture() {
  const query = { query: { status: { option: 'available' }, stats: [{ type: 'weight', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }], value: { min: 1 } }], filters: { trade_filters: { filters: { price: { max: 30, option: 'chaos' } } } } }, sort: { price: 'asc' } };
  const generate = jest.fn(async () => ({ query, weightBaselines: [{ stat: 'MinionCombinedDPS', value: 100, method: 'pob_power_stat' }] }));
  const foundation = { runReadOnlySnapshot: async (id: string, operation: (engine: unknown) => Promise<unknown>) => ({ snapshotId: id, identity: { engineVersion: 'fixture' }, warnings: [], result: await operation({ getStats: async () => ({ MinionCombinedDPS: 100 }), generateWeightedTradeQuery: generate }) }) } as unknown as BuildFoundation;
  const search = jest.fn(async (league, input) => ({ source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(input)) }, data: { id: 'search', total: 2, result: [itemId, missingId], inexact: true } }));
  const stats = jest.fn(async () => ({ source: 'official-trade', fetchedAt: time, request: { kind: 'stats' }, data: { result: [] } }));
  const fetchListings = jest.fn(async (ids, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [{ id: itemId, item: { id: itemId }, listing: { price: { amount: 2, currency: 'chaos' } } }], missingIds: [missingId] } }));
  return { foundation, source: { search, stats, fetchListings } as unknown as OfficialTradeSource, generate, search, fetchListings, query };
}

it('preserves PoB filters, enforces securable priced, and exposes missing listings and provenance', async () => {
  const f = fixture(), tool = createWeightedTradeTools(f.foundation, f.source, () => true)[1];
  const result = JSON.parse((await tool.invoke({ ...args, league: 'Standard', limit: 2 })).content[0].text);
  expect(result.query.query.status.option).toBe('securable');
  expect(result.query.query.filters.trade_filters.filters).toEqual({ price: { max: 30, option: 'chaos' }, sale_type: { option: 'priced' } });
  expect(f.query.query.status.option).toBe('available');
  expect(result.listingScope).toBe('instant_buyout'); expect(result.missingListingIds).toEqual([missingId]);
  expect(result.inexact).toBe(true); expect(result.sourceTimes).toEqual({ stats: time, search: time, listings: time });
  expect(f.search).toHaveBeenCalledWith('Standard', result.query); expect(f.fetchListings).toHaveBeenCalledWith([itemId, missingId], 'search');
  expect(f.generate).toHaveBeenCalledWith('Amulet', expect.objectContaining({ statWeights: [{ label: 'MinionCombinedDPS', stat: 'MinionCombinedDPS', weightMult: 1 }], maxPrice: 30, maxPriceType: 'chaos' }));
});

it('requires authentication before calculations and refuses invalid or empty baselines', async () => {
  const f = fixture(), tools = createWeightedTradeTools(f.foundation, f.source, () => false);
  await expect(tools[1].invoke({ ...args, league: 'Standard' })).rejects.toThrow('POE_SESSION_ID');
  expect(f.generate).not.toHaveBeenCalled(); expect(f.search).not.toHaveBeenCalled();
  await expect(tools[0].invoke({ ...args, weights: [{ stat: 'Life', weight: -1 }] })).rejects.toThrow('positive metric weights');
  await expect(tools[0].invoke({ ...args, weights: [{ stat: 'Life', weight: 1 }] })).rejects.toThrow('positive finite native baselines');
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it('refuses invalid fetched provenance rather than presenting foreign results', async () => {
  const f = fixture();
  f.fetchListings.mockImplementationOnce(async (ids, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids, queryId }, data: { listings: [], missingIds: [] } }));
  await expect(createWeightedTradeTools(f.foundation, f.source, () => true)[1].invoke({ ...args, league: 'Standard' })).rejects.toThrow('inconsistent listings');
});

it('does not activate disabled generated trade filters to force a price requirement', async () => {
  const f = fixture();
  Object.assign(f.query.query.filters.trade_filters, { disabled: true });
  await expect(createWeightedTradeTools(f.foundation, f.source, () => true)[1].invoke({ ...args, league: 'Standard' })).rejects.toThrow('disabled or invalid trade filters');
  expect(f.search).not.toHaveBeenCalled();
});

it('reports missing sources without suggesting a boolean group that changes weighted scoring', async () => {
  const warnings = await auditWeightedSources({ getStats: async () => ({ result: [{ label: 'fixture', entries: [{ id: 'explicit.stat_1', type: 'explicit', text: '+# to maximum Life' }, { id: 'fractured.stat_2', type: 'fractured', text: '+# to maximum Life' }] }] }) }, [{ type: 'weight', filters: [{ id: 'explicit.stat_1' }] }]);
  expect(warnings.join(' ')).toContain('fractured');
  expect(warnings.join(' ')).not.toMatch(/count\/or|boolean/i);
});
