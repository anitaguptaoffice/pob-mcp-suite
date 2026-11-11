import { OfficialTradeAdapter } from '../../src/adapters/officialTrade/officialTradeAdapter.js';
import { TradeApiClient } from '../../src/services/tradeClient.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const query: TradeQuery = { query: { status: { option: 'securable' }, filters: { trade_filters: { filters: { sale_type: { option: 'priced' } } } } }, sort: { price: 'asc' } };
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('shared official Trade source in compatibility mode', () => {
  it('coalesces old and new searches and preserves query, original timestamp and source data', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const fetcher = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual(query);
      return ok({ id: 'query1', total: 1, result: ['item1'] });
    });
    const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, now: () => now, minTimeMs: 0 });
    const old = new TradeApiClient({ source });
    const [oldResult, fresh] = await Promise.all([old.searchItems('Standard', query), source.search('Standard', query)]);
    expect(oldResult).toEqual(fresh.data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2000;
    expect((await source.search('Standard', query)).fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('uses the same cooldown in both directions after a 429', async () => {
    for (const first of ['old', 'new']) {
      const fetcher = jest.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
      const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, now: () => 0, minTimeMs: 0 });
      const old = new TradeApiClient({ source });
      if (first === 'old') {
        await expect(old.searchItems('Standard', query)).rejects.toMatchObject({ code: 'rate-limit' });
        await expect(source.leagues()).rejects.toMatchObject({ code: 'rate-limit', retryAfterMs: 2000 });
      } else {
        await expect(source.search('Standard', query)).rejects.toMatchObject({ code: 'rate-limit' });
        await expect(old.getLeagues()).rejects.toMatchObject({ code: 'rate-limit', retryAfterMs: 2000 });
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('serializes distinct requests across old and new clients', async () => {
    let active = 0, peak = 0;
    const fetcher = jest.fn(async (url: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return url.includes('/search/') ? ok({ id: 'query1', total: 0, result: [] }) : ok({ result: [] });
    });
    const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, minTimeMs: 0 });
    const old = new TradeApiClient({ source });
    await Promise.all([old.searchItems('Standard', query), source.leagues()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
  it('preserves legacy normalized listings without mutating the source cache', async () => {
    const fetcher = jest.fn(async () => ok({ result: [{ id: 'item1', listing: {}, item: { explicitMods: [{ name: 'Armour', values: [['25', 0]] }] } }] }));
    const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, minTimeMs: 0 });
    const old = new TradeApiClient({ source });
    const normalized = await old.fetchItems(['item1', 'item1'], 'query1');
    expect(typeof normalized[0].item?.explicitMods?.[0]).toBe('string');
    const fresh = await source.fetchListings(['item1'], 'query1');
    expect(typeof fresh.data.listings[0].item?.explicitMods?.[0]).toBe('object');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
