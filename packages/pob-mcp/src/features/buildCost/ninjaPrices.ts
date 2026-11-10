/** Public poe.ninja economy endpoint. This module does not use build/profile APIs. */
import type { PriceCategory, PriceLine, PriceSnapshot } from './priceTypes.js';
export type { PriceCategory, PriceLine, PriceSnapshot } from './priceTypes.js';

/** Independently cache each league/category; never cache failures as empty prices. */
export class NinjaPrices {
  private static readonly maxCacheEntries = 100;
  private readonly cache = new Map<string, { until: number; snapshot: PriceSnapshot }>();
  private readonly pending = new Map<string, Promise<PriceSnapshot>>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async get(league: string, category: PriceCategory): Promise<PriceSnapshot> {
    const key = JSON.stringify([league, category]);
    const cached = this.cache.get(key);
    if (cached && cached.until > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.snapshot;
    }
    if (cached) this.cache.delete(key);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.load(league, category).then(snapshot => {
      this.cache.set(key, { until: this.now() + 10 * 60_000, snapshot });
      while (this.cache.size > NinjaPrices.maxCacheEntries) this.cache.delete(this.cache.keys().next().value!);
      return snapshot;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async load(league: string, category: PriceCategory): Promise<PriceSnapshot> {
    const query = new URLSearchParams({ league, type: category });
    const response = await this.fetcher(`https://poe.ninja/poe1/api/economy/stash/current/item/overview?${query}`, {
      headers: { 'User-Agent': 'pob-mcp-suite/1.0 (+https://github.com/anitaguptaoffice/pob-mcp-suite)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`poe.ninja ${category}: HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as { lines?: unknown }).lines)) {
      throw new Error(`poe.ninja ${category}: invalid response`);
    }
    return { lines: (data as { lines: PriceLine[] }).lines, fetchedAt: new Date(this.now()).toISOString() };
  }
}
