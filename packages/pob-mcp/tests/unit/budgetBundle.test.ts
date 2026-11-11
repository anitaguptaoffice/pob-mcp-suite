import { createBudgetBundleTool } from '../../src/features/budgetCandidates/bundle.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';

const snapshotId = 'a'.repeat(64), time = '2026-01-01T00:00:00.000Z';
const ids = ['b'.repeat(64), 'c'.repeat(64)];
const text = 'Item Class: Rings\nRarity: Rare\nExample\nGold Ring\n+50 to maximum Life';
const input = { snapshot_id: snapshotId, league: 'Standard', budget_chaos: 0.3, fields: ['Life'], searches: [{ slot: 'Ring 1', item_type: 'Gold Ring', item_rarity: 'rare' }, { slot: 'Ring 2', item_type: 'Gold Ring', item_rarity: 'rare' }] };

function fixture(prices = [0.1, 0.2], type = '~b/o', inexact = false) {
  let searchCount = 0;
  const search = jest.fn(async (league, query) => {
    const index = searchCount++;
    return { source: 'official-trade', fetchedAt: time, request: { league, query: JSON.parse(JSON.stringify(query)) }, data: { id: `search-${index}`, result: [ids[index]], total: 1, inexact } };
  });
  const fetchListings = jest.fn(async (requestIds: string[], queryId: string) => {
    const index = ids.indexOf(requestIds[0]);
    return { source: 'official-trade', fetchedAt: time, request: { ids: requestIds, queryId }, data: { listings: [{ id: ids[index], item: { id: ids[index], league: 'Standard', identified: true, verified: true, typeLine: 'Gold Ring', name: 'Example', extended: { text: Buffer.from(text).toString('base64') } }, listing: { price: { type, amount: prices[index], currency: 'chaos' } } }], missingIds: [] } };
  });
  const identity = { engineVersion: 'v', adapterVersion: 'a', dataVersion: 'd', runtimeVersion: 'r', executableVersion: 'x' };
  const evaluate = jest.fn(async (id: string) => ({ snapshotId: id, identity, context: { config: {}, selection: {} }, warnings: [], metrics: { Life: { status: 'available', value: id === snapshotId ? 100 : 200 } } }));
  const inspect = jest.fn(async (id: string) => ({ snapshotId: id, identity, warnings: [], data: { tree: { treeVersion: '3_29' } } }));
  const deriveItems = jest.fn(async () => ({ id: 'd'.repeat(64), parentId: snapshotId, retention: { kind: 'trial' } }));
  const previewItem = jest.fn(async () => ({ delta: { Life: 50 }, parseDiagnostics: {} }));
  const foundation = { readSnapshot: async () => ({ id: snapshotId }), previewItem, deriveItems, evaluate, inspect } as unknown as BuildFoundation;
  const source = { search, fetchListings } as unknown as OfficialTradeSource;
  return { search, fetchListings, previewItem, deriveItems, evaluate, tool: createBudgetBundleTool(foundation, source) };
}
const result = async (f: ReturnType<typeof fixture>, args = input) => JSON.parse((await f.tool.invoke(args)).content[0].text);

it('compares two selected explicit buyouts together with exact decimal budget arithmetic', async () => {
  const f = fixture(), out = await result(f);
  expect(out.status).toBe('compared'); expect(out.subtotal).toEqual({ amount: '0.3', currency: 'chaos', withinBudget: true });
  expect(out.comparison.metrics.Life.delta).toBe(100); expect(out.trial.parentId).toBe(snapshotId);
  expect(f.deriveItems).toHaveBeenCalledWith(snapshotId, [{ slot: 'Ring 1', itemText: text }, { slot: 'Ring 2', itemText: text }], true);
  for (const entry of out.searches) { expect(entry.query.query.status.option).toBe('securable'); expect(entry.query.query.filters.trade_filters.filters.sale_type.option).toBe('priced'); expect(entry.query.query.filters.type_filters.filters.rarity.option).toBe('rare'); }
});

it('does not create a trial when the selected sum exceeds the budget', async () => {
  const f = fixture(), out = await result(f, { ...input, budget_chaos: 0.29 });
  expect(out.status).toBe('over_budget'); expect(out.subtotal).toMatchObject({ amount: '0.3', withinBudget: false }); expect(f.deriveItems).not.toHaveBeenCalled();
});

it('does not treat negotiated or inexact listings as a verified bundle', async () => {
  const negotiated = fixture([0.1, 0.2], '~price');
  const noBuyout = await result(negotiated); expect(noBuyout.status).toBe('incomplete'); expect(noBuyout.searches[0].candidateFailures[0].error).toContain('explicit chaos buyout'); expect(negotiated.deriveItems).not.toHaveBeenCalled();
  const inexact = fixture([0.1, 0.2], '~b/o', true);
  const uncertain = await result(inexact); expect(uncertain.status).toBe('incomplete'); expect(uncertain.reason).toContain('inexact'); expect(inexact.previewItem).not.toHaveBeenCalled();
});

it('does not select a fixed-price item with an unverified or mismatched league', async () => {
  for (const [verified, league, reason] of [[false, 'Standard', 'unverified_item'], [true, 'Other', 'league_unconfirmed']] as const) {
    const f = fixture();
    f.fetchListings.mockImplementationOnce(async (requestIds, queryId) => ({ source: 'official-trade', fetchedAt: time, request: { ids: requestIds, queryId }, data: { listings: [{ id: ids[0], item: { id: ids[0], league, identified: true, verified, typeLine: 'Gold Ring', name: 'Example', extended: { text: Buffer.from(text).toString('base64') } }, listing: { price: { type: '~b/o', amount: 0.1, currency: 'chaos' } } }], missingIds: [] } }));
    const out = await result(f);
    expect(out.status).toBe('incomplete'); expect(out.searches[0].candidateFailures[0].error).toContain(reason);
    expect(f.previewItem).not.toHaveBeenCalled(); expect(f.deriveItems).not.toHaveBeenCalled();
  }
});

it('retains preview failures and never silently publishes an incomplete trial', async () => {
  const f = fixture(); f.previewItem.mockRejectedValueOnce(new Error('PoB cannot parse candidate'));
  const out = await result(f);
  expect(out.status).toBe('incomplete');
  expect(out.searches[0].candidateFailures).toEqual([{ itemId: ids[0], error: 'PoB cannot parse candidate' }]);
  expect(f.deriveItems).not.toHaveBeenCalled();
});

it('compares scientific-notation prices without floating point rounding', async () => {
  const f = fixture([1e-7, 2e-7]);
  const out = await result(f, { ...input, budget_chaos: 3e-7 });
  expect(out.subtotal).toEqual({ amount: '0.0000003', currency: 'chaos', withinBudget: true });
});

it('returns the trial ID if the later comparison fails', async () => {
  const f = fixture(); f.evaluate.mockRejectedValueOnce(new Error('engine unavailable'));
  const out = await result(f); expect(out.status).toBe('error'); expect(out.trial.snapshotId).toBe('d'.repeat(64)); expect(out.error).toContain('engine unavailable');
});

it('validates all options before accessing the market', async () => {
  const f = fixture();
  await expect(result(f, { ...input, searches: [input.searches[0], input.searches[0]] })).rejects.toThrow('distinct');
  expect(f.search).not.toHaveBeenCalled();
});
