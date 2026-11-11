import { OfficialTradeAdapter } from '../../src/adapters/officialTrade/officialTradeAdapter.js';
import type { TradeQuery } from '../../src/types/tradeTypes.js';

const query: TradeQuery = { query: { status: { option: 'securable' }, filters: { trade_filters: { filters: { sale_type: { option: 'priced' } } } } }, sort: { price: 'asc' } };
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('official Trade source adapter', () => {
  it('backs off exponentially between transient server failures', async () => {
    const original = globalThis.setTimeout;
    const delays: number[] = [];
    const timer = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      delays.push(Number(delay)); return original(callback, 0, ...args);
    });
    try {
      const fetcher = jest.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(ok({ result: [] }));
      await new OfficialTradeAdapter({ fetcher, minTimeMs: 0, maxRetries: 2, retryDelayMs: 40 }).stats();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(delays.filter(delay => delay >= 40)).toEqual([40, 80]);
    } finally { timer.mockRestore(); }
  });
  it('coalesces identical requests while serializing distinct requests through the shared adapter', async () => {
    let active = 0, maximum = 0;
    const fetcher = jest.fn(async (url: string) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return url.includes('/search/') ? ok({ id: 'search', total: 0, result: [] }) : ok({ result: [] });
    });
    const source = new OfficialTradeAdapter({ fetcher: fetcher as typeof fetch, minTimeMs: 0 });
    const [left, right] = await Promise.all([source.search('Standard', query), source.search('Standard', query), source.stats(), source.leagues()]);
    expect(fetcher).toHaveBeenCalledTimes(3); expect(maximum).toBe(1);
    expect(left).toEqual(right);
    left.data.result.push('local'); expect(right.data.result).toEqual([]);
  });
  it('retries network failures, stops at the retry bound and never retries client errors', async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(ok({ result: [] }));
    const source = new OfficialTradeAdapter({ fetcher, minTimeMs: 0, retryDelayMs: 0, maxRetries: 1 });
    expect((await source.stats()).data.result).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const unavailable = jest.fn(async () => { throw new Error('offline'); });
    await expect(new OfficialTradeAdapter({ fetcher: unavailable, minTimeMs: 0, retryDelayMs: 0, maxRetries: 1 }).stats()).rejects.toMatchObject({ code: 'network' });
    expect(unavailable).toHaveBeenCalledTimes(2);
    const invalid = jest.fn(async () => new Response('', { status: 400 }));
    await expect(new OfficialTradeAdapter({ fetcher: invalid, minTimeMs: 0, maxRetries: 2 }).stats()).rejects.toMatchObject({ httpStatus: 400 });
    expect(invalid).toHaveBeenCalledTimes(1);
  });
  it('preserves the exact query, credential separation and original fetch time', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    let session: string | undefined = 'session-one';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return ok({ id: 'search1', total: 1, result: ['item1'] }); }) as unknown as typeof fetch;
    const source = new OfficialTradeAdapter({ fetcher, session: () => session, now: () => now, minTimeMs: 0 });
    const first = await source.search('Standard', query);
    expect(first.request).toEqual({ league: 'Standard', query });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(query);
    expect((calls[0].init?.headers as Record<string, string>).Cookie).toBe('POESESSID=session-one');
    expect(first.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    first.data.result.push('local-mutation');
    now += 1000;
    const cached = await source.search('Standard', query);
    expect(cached.data.result).toEqual(['item1']);
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(calls).toHaveLength(1);
    session = 'session-two';
    await source.search('Standard', query);
    session = undefined;
    await source.search('Standard', query);
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(cached)).not.toContain('session-one');
  });

  it('keeps search contexts separate and reports partially unavailable listings', async () => {
    const requests: string[] = [];
    const fetcher = (async (url: string) => { requests.push(url); return ok({ result: [{ id: 'item2', listing: {}, item: { extended: { hashes: { fractured: [['fractured.stat_1', [0]]] } } } }] }); }) as unknown as typeof fetch;
    const source = new OfficialTradeAdapter({ fetcher, minTimeMs: 0 });
    const result = await source.fetchListings(['item1', 'item2'], 'queryA');
    expect(result.data.missingIds).toEqual(['item1']);
    expect(result.data.listings[0].item?.extended?.hashes?.fractured).toEqual([['fractured.stat_1', [0]]]);
    expect(result.request).toEqual({ ids: ['item1', 'item2'], queryId: 'queryA' });
    await source.fetchListings(['item1', 'item2'], 'queryB');
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('query=queryA');
    expect(requests[1]).toContain('query=queryB');
    const longQueryId = 'q'.repeat(143);
    await source.fetchListings(['item1', 'item2'], longQueryId);
    expect(requests[2]).toContain(`query=${longQueryId}`);
    await expect(source.fetchListings(['item1', 'item1'], 'queryA')).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('respects server rate-limit cooldown without automatic retries or false empty results', async () => {
    let now = 0;
    const fetcher = jest.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
    const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, now: () => now, minTimeMs: 0, maxRetries: 2, retryDelayMs: 0 });
    await expect(source.search('Standard', query)).rejects.toMatchObject({ code: 'rate-limit', httpStatus: 429, retryAfterMs: 2000 });
    await expect(source.stats()).rejects.toMatchObject({ code: 'rate-limit', retryAfterMs: 2000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 2001;
    await expect(source.stats()).rejects.toMatchObject({ code: 'rate-limit' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries transient server failures, rejects malformed responses and does not cache errors', async () => {
    let calls = 0;
    const fetcher = jest.fn(async () => { calls++; return calls === 1 ? new Response('', { status: 503 }) : calls === 2 ? ok({ bad: [] }) : ok({ result: [] }); });
    const source = new OfficialTradeAdapter({ fetcher: fetcher as unknown as typeof fetch, minTimeMs: 0, maxRetries: 1, retryDelayMs: 0 });
    await expect(source.stats()).rejects.toMatchObject({ code: 'invalid-response' });
    expect((await source.stats()).data.result).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(source.search('Standard', { query: { status: { option: 'securable' } }, sort: { price: 'asc' }, extra: NaN } as unknown as TradeQuery)).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('rejects malformed league and stat metadata instead of returning partial source coverage', async () => {
    const fetcher = (async (url: string) => url.includes('/leagues') ? ok({ result: [{}] }) : ok({ result: [{ entries: [{ id: 'x', text: 'Life' }] }] })) as unknown as typeof fetch;
    const source = new OfficialTradeAdapter({ fetcher, minTimeMs: 0 });
    await expect(source.leagues()).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(source.stats()).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects malformed listing payloads instead of counting them as available samples', async () => {
    const fetcher = (async () => ok({ result: [{ id: 'item1', item: {} }] })) as unknown as typeof fetch;
    const source = new OfficialTradeAdapter({ fetcher, minTimeMs: 0 });
    await expect(source.fetchListings(['item1'], 'query')).rejects.toMatchObject({ code: 'invalid-response' });
  });
});
