import { BoundedCache } from '../../src/foundation/cache.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('BoundedCache', () => {
  it('coalesces concurrent loads, preserves source time and respects expiration', async () => {
    let now = 100;
    const cache = new BoundedCache<{ fetchedAt: number }>(2, 2, () => now);
    const gate = deferred<{ fetchedAt: number }>();
    const loader = jest.fn(() => gate.promise);
    const first = cache.get('league/a', 10, loader);
    const second = cache.get('league/a', 10, loader);
    gate.resolve({ fetchedAt: 77 });
    expect(await first).toEqual({ value: { fetchedAt: 77 }, cached: false, loadedAt: 100 });
    expect(await second).toEqual(await first);
    expect(loader).toHaveBeenCalledTimes(1);
    now = 105;
    expect(await cache.get('league/a', 10, loader)).toEqual({ value: { fetchedAt: 77 }, cached: true, loadedAt: 100 });
    now = 111;
    expect((await cache.get('league/a', 10, async () => ({ fetchedAt: 111 }))).value.fetchedAt).toBe(111);
  });
  it('does not cache failures, and invalidation prevents stale in-flight writes', async () => {
    const cache = new BoundedCache<number>(1, 2);
    await expect(cache.get('a', 100, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    const old = deferred<number>();
    const pending = cache.get('a', 10000, () => old.promise);
    cache.invalidate('a');
    expect((await cache.get('a', 10000, async () => 2)).value).toBe(2);
    old.resolve(1);
    expect((await pending).value).toBe(1);
    expect(await cache.get('a', 10000, async () => 3)).toMatchObject({ value: 2, cached: true });
    await cache.get('b', 10000, async () => 4);
    expect(await cache.get('a', 10000, async () => 5)).toMatchObject({ value: 5, cached: false });
  });
  it('bounds active loads even after invalidation', async () => {
    const cache = new BoundedCache<number>(1, 1);
    const gate = deferred<number>();
    const first = cache.get('a', 100, () => gate.promise);
    cache.invalidate('a');
    await expect(cache.get('b', 100, async () => 2)).rejects.toThrow('load limit');
    gate.resolve(1);
    await first;
    expect((await cache.get('b', 100, async () => 2)).value).toBe(2);
  });
});
