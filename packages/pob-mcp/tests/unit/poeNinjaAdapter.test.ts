import { PoeNinjaAdapter } from '../../src/adapters/poeNinja/poeNinjaAdapter.js';

describe('poe.ninja source adapter', () => {
  it('preserves provenance and source data across cache hits, with isolated query keys', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    const fetcher = jest.fn(async (_url: string) => new Response(JSON.stringify({ lines: [{ name: 'Example', chaosValue: 3 }], extra: 'native' }), { status: 200 }));
    const source = new PoeNinjaAdapter(fetcher as unknown as typeof fetch, () => now);
    const query = { kind: 'items' as const, league: 'Standard', category: 'UniqueArmour' as const };
    const first = await source.read(query);
    expect(first).toMatchObject({ source: 'poe.ninja', query, fetchedAt: '2026-01-01T00:00:00.000Z', payload: { extra: 'native' } });
    (first.payload.lines as Array<{ chaosValue: number }>)[0].chaosValue = 99;
    now += 5000;
    const second = await source.read(query);
    expect((second.payload.lines as Array<{ chaosValue: number }>)[0].chaosValue).toBe(3);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    await source.read({ ...query, league: 'Other League' });
    await source.read({ ...query, category: 'SkillGem' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('league=Standard&type=UniqueArmour');
    now += 600_000;
    expect((await source.read(query)).fetchedAt).not.toBe(first.fetchedAt);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('uses distinct public endpoints and cache entries for reference and spread data', async () => {
    const urls: string[] = [];
    const fetcher = jest.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify({ lines: [], items: [] }), { status: 200 }); });
    const source = new PoeNinjaAdapter(fetcher as unknown as typeof fetch);
    await source.read({ kind: 'currency', league: 'Standard' });
    await source.read({ kind: 'currency-spread', league: 'Standard' });
    expect(urls[0]).toContain('/poe1/api/economy/exchange/current/overview?');
    expect(urls[1]).toContain('/poe1/api/economy/stash/current/currency/overview?');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns typed failures without caching them as empty markets', async () => {
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls++;
      return calls === 1 ? new Response('unavailable', { status: 503 })
        : calls === 2 ? new Response(JSON.stringify({ unexpected: [] }), { status: 200 })
          : new Response(JSON.stringify({ lines: [] }), { status: 200 });
    });
    const source = new PoeNinjaAdapter(fetcher as unknown as typeof fetch);
    const query = { kind: 'currency' as const, league: 'Standard' };
    await expect(source.read(query)).rejects.toMatchObject({ code: 'http', httpStatus: 503 });
    await expect(source.read(query)).rejects.toMatchObject({ code: 'invalid-response' });
    expect((await source.read(query)).payload.lines).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(source.read({ kind: 'currency', league: ' ' })).rejects.toMatchObject({ code: 'invalid-query' });
  });
});
