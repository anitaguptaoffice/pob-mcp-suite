import { BoundedCache } from '../../infrastructure/cache.js';
import type { EconomyQuery, EconomySnapshot, EconomySource } from '../../ports/economySource.js';

const itemCategories = new Set(['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'SkillGem']);

export class EconomySourceError extends Error {
  constructor(readonly code: 'invalid-query' | 'http' | 'network' | 'invalid-response' | 'unavailable', message: string, options?: ErrorOptions, readonly httpStatus?: number) {
    super(message, options);
    this.name = 'EconomySourceError';
  }
}

/** Public PoE 1 economy data only; no build/profile endpoints or trade policy. */
export class PoeNinjaAdapter implements EconomySource {
  private readonly cache: BoundedCache<EconomySnapshot>;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    this.cache = new BoundedCache(100, 8, now);
  }

  async read(query: EconomyQuery): Promise<EconomySnapshot> {
    if (!query || typeof query.league !== 'string' || !query.league.trim() || query.league.length > 100 ||
        !['items', 'currency', 'currency-spread'].includes(query.kind) || (query.kind === 'items' && !itemCategories.has(query.category))) {
      throw new EconomySourceError('invalid-query', 'A valid international league and economy category are required');
    }
    const request: EconomyQuery = query.kind === 'items'
      ? { kind: 'items', league: query.league.trim(), category: query.category }
      : { kind: query.kind, league: query.league.trim() };
    const ttl = request.kind === 'items' ? 10 * 60_000 : 5 * 60_000;
    const key = JSON.stringify(request);
    let cached;
    try { cached = await this.cache.get(key, ttl, () => this.fetchSnapshot(request)); }
    catch (cause) {
      if (cause instanceof EconomySourceError) throw cause;
      throw new EconomySourceError('unavailable', 'poe.ninja adapter is unavailable', { cause });
    }
    // A feature may enrich the source response; never let it mutate shared cache.
    return structuredClone(cached.value);
  }

  private async fetchSnapshot(query: EconomyQuery): Promise<EconomySnapshot> {
    const endpoint = query.kind === 'items' ? 'https://poe.ninja/poe1/api/economy/stash/current/item/overview'
      : query.kind === 'currency' ? 'https://poe.ninja/poe1/api/economy/exchange/current/overview'
        : 'https://poe.ninja/poe1/api/economy/stash/current/currency/overview';
    const params = new URLSearchParams({ league: query.league, type: query.kind === 'items' ? query.category : 'Currency' });
    let response: Response;
    try {
      response = await this.fetcher(`${endpoint}?${params}`, { headers: { 'User-Agent': 'pob-mcp-suite/1.0 (+https://github.com/anitaguptaoffice/pob-mcp-suite)' }, signal: AbortSignal.timeout(15_000) });
    } catch (cause) { throw new EconomySourceError('network', 'poe.ninja request failed', { cause }); }
    if (!response.ok) throw new EconomySourceError('http', `poe.ninja returned HTTP ${response.status}`, undefined, response.status);
    let payload: unknown;
    try { payload = await response.json(); }
    catch (cause) { throw new EconomySourceError('invalid-response', 'poe.ninja returned invalid JSON', { cause }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray((payload as Record<string, unknown>).lines)) {
      throw new EconomySourceError('invalid-response', 'poe.ninja response does not contain a lines array');
    }
    return { source: 'poe.ninja', query, fetchedAt: new Date(this.now()).toISOString(), payload: payload as Record<string, unknown> };
  }
}
