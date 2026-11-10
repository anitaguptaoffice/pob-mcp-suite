import Bottleneck from 'bottleneck';
import { createHash } from 'node:crypto';
import { BoundedCache } from '../../infrastructure/cache.js';
import type { OfficialTradeSource, TradeSourceResult } from '../../ports/officialTrade.js';
import type { ItemListing, LeagueData, SearchResult, StatData, TradeQuery } from '../../types/tradeTypes.js';

export class OfficialTradeError extends Error {
  constructor(readonly code: 'invalid-request' | 'http' | 'rate-limit' | 'network' | 'invalid-response' | 'unavailable', message: string,
    readonly httpStatus?: number, readonly retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OfficialTradeError';
  }
}

type Request = { kind: 'search'; league: string; query: TradeQuery } | { kind: 'fetch'; ids: string[]; queryId: string | null }
  | { kind: 'stats' } | { kind: 'leagues' };
const validListingId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
// Current official search IDs can exceed the length of individual listing IDs.
const validQueryId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);

/** International PoE 1 official Trade data; query policy stays with the caller. */
export class OfficialTradeAdapter implements OfficialTradeSource {
  private readonly cache: BoundedCache<TradeSourceResult<unknown, Request>>;
  private readonly limiter: Bottleneck;
  private pausedUntil = 0;
  constructor(private readonly options: { fetcher?: typeof fetch; now?: () => number; session?: () => string | undefined; minTimeMs?: number; maxRetries?: number; retryDelayMs?: number } = {}) {
    this.cache = new BoundedCache(200, 16, options.now);
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: options.minTimeMs ?? 250 });
  }

  async search(league: string, query: TradeQuery): Promise<TradeSourceResult<SearchResult, { league: string; query: TradeQuery }>> {
    if (typeof league !== 'string' || !league.trim() || league.length > 100 || !query || typeof query !== 'object' || !query.query || typeof query.query !== 'object' || Array.isArray(query.query)) {
      throw new OfficialTradeError('invalid-request', 'An international league and a trade query are required');
    }
    const validateJson = (value: unknown, seen: Set<object>, inArray = false): void => {
      if (value === undefined && !inArray) return;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number' && Number.isFinite(value)) return;
      if (!value || typeof value !== 'object' || seen.has(value)) throw new OfficialTradeError('invalid-request', 'Trade query contains a non-JSON value');
      const proto = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new OfficialTradeError('invalid-request', 'Trade query contains a non-JSON object');
      seen.add(value);
      if (Array.isArray(value)) for (const entry of value) validateJson(entry, seen, true);
      else for (const entry of Object.values(value)) validateJson(entry, seen);
      seen.delete(value);
    };
    validateJson(query, new Set());
    const encoded = JSON.stringify(query);
    if (Buffer.byteLength(encoded, 'utf8') > 100_000) throw new OfficialTradeError('invalid-request', 'Trade query is too large');
    const request: Request = { kind: 'search', league: league.trim(), query: JSON.parse(encoded) as TradeQuery };
    const response = await this.read(request, 300_000);
    const data = response.data as SearchResult;
    return { source: response.source, fetchedAt: response.fetchedAt, request: { league: request.league, query: request.query }, data };
  }

  async fetchListings(ids: string[], queryId?: string): Promise<TradeSourceResult<{ listings: ItemListing[]; missingIds: string[] }, { ids: string[]; queryId: string | null }>> {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || ids.some(id => !validListingId(id)) || new Set(ids).size !== ids.length || (queryId !== undefined && !validQueryId(queryId))) {
      throw new OfficialTradeError('invalid-request', 'Provide 1 to 10 unique listing IDs and a valid optional query ID');
    }
    const request: Request = { kind: 'fetch', ids: [...ids], queryId: queryId ?? null };
    const response = await this.read(request, 300_000);
    const listings = response.data as ItemListing[];
    const returned = new Set(listings.map(listing => listing.id));
    return { source: response.source, fetchedAt: response.fetchedAt, request: { ids: request.ids, queryId: request.queryId },
      data: { listings, missingIds: ids.filter(id => !returned.has(id)) } };
  }

  async stats(): Promise<TradeSourceResult<StatData, { kind: 'stats' }>> {
    const response = await this.read({ kind: 'stats' }, 3_600_000);
    return { ...response, request: { kind: 'stats' }, data: response.data as StatData };
  }

  async leagues(): Promise<TradeSourceResult<LeagueData, { kind: 'leagues' }>> {
    const response = await this.read({ kind: 'leagues' }, 3_600_000);
    return { ...response, request: { kind: 'leagues' }, data: response.data as LeagueData };
  }

  private async read(request: Request, ttl: number): Promise<TradeSourceResult<unknown, Request>> {
    const session = this.options.session?.();
    if (session !== undefined && (typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(session))) throw new OfficialTradeError('invalid-request', 'Invalid trade session');
    const credentialScope = session ? createHash('sha256').update(session).digest('hex') : 'anonymous';
    const key = JSON.stringify([credentialScope, request]);
    try {
      const result = await this.cache.get(key, ttl, () => this.limiter.schedule(() => this.request(request, session)));
      return structuredClone(result.value);
    } catch (cause) {
      if (cause instanceof OfficialTradeError) throw cause;
      throw new OfficialTradeError('unavailable', 'Official Trade adapter is unavailable', undefined, undefined, { cause });
    }
  }

  private async request(request: Request, session?: string): Promise<TradeSourceResult<unknown, Request>> {
    const remaining = this.pausedUntil - (this.options.now ?? Date.now)();
    if (remaining > 0) throw new OfficialTradeError('rate-limit', 'Official Trade rate limit cooldown is active', 429, remaining);
    const base = 'https://www.pathofexile.com/api/trade';
    const url = request.kind === 'search' ? `${base}/search/${encodeURIComponent(request.league)}`
      : request.kind === 'fetch' ? `${base}/fetch/${request.ids.join(',')}${request.queryId ? `?query=${encodeURIComponent(request.queryId)}` : ''}`
        : `${base}/data/${request.kind}`;
    const init: RequestInit = { method: request.kind === 'search' ? 'POST' : 'GET', headers: {
      'Content-Type': 'application/json', 'User-Agent': 'pob-mcp-suite/1.0 (+https://github.com/anitaguptaoffice/pob-mcp-suite)',
      ...(session ? { Cookie: `POESESSID=${session}` } : {}),
    }, ...(request.kind === 'search' ? { body: JSON.stringify(request.query) } : {}) };
    const maxRetries = Math.max(0, Math.min(5, this.options.maxRetries ?? 2));
    let response: Response | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        response = await (this.options.fetcher ?? fetch)(url, { ...init, signal: AbortSignal.timeout(30_000) });
        if (response.status === 429) {
          const header = response.headers.get('Retry-After');
          const seconds = header === null ? NaN : Number(header);
          const when = header === null ? NaN : Date.parse(header);
          const retry = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(when) ? Math.max(0, when - (this.options.now ?? Date.now)()) : 5000;
          this.pausedUntil = Math.max(this.pausedUntil, (this.options.now ?? Date.now)() + retry);
          throw new OfficialTradeError('rate-limit', 'Official Trade rate limit reached', 429, retry);
        }
        if (!response.ok) throw new OfficialTradeError('http', `Official Trade returned HTTP ${response.status}`, response.status);
        break;
      } catch (error) {
        if (error instanceof OfficialTradeError && (error.code === 'rate-limit' || (error.httpStatus ?? 0) < 500)) throw error;
        if (attempt === maxRetries) {
          if (error instanceof OfficialTradeError) throw error;
          throw new OfficialTradeError('network', 'Official Trade request failed', undefined, undefined, { cause: error });
        }
        await new Promise(resolve => setTimeout(resolve, (this.options.retryDelayMs ?? 500) * 2 ** attempt));
      }
    }
    let payload: unknown;
    try { payload = await response!.json(); }
    catch (cause) { throw new OfficialTradeError('invalid-response', 'Official Trade returned invalid JSON', response?.status, undefined, { cause }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray((payload as { result?: unknown }).result)) throw new OfficialTradeError('invalid-response', 'Official Trade response does not contain a result array');
    const body = payload as Record<string, unknown> & { result: unknown[] };
    if (request.kind === 'search' && (!validQueryId(body.id) || !Number.isSafeInteger(body.total) || (body.total as number) < 0 || body.result.some(id => !validListingId(id)))) throw new OfficialTradeError('invalid-response', 'Invalid Official Trade search response');
    if (request.kind === 'fetch' && (body.result.some(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
      const listing = entry as { id?: unknown; item?: unknown; listing?: unknown };
      return typeof listing.id !== 'string' || !request.ids.includes(listing.id) || !listing.item || typeof listing.item !== 'object' || Array.isArray(listing.item) ||
        !listing.listing || typeof listing.listing !== 'object' || Array.isArray(listing.listing) ||
        (typeof (listing.item as { id?: unknown }).id === 'string' && (listing.item as { id: string }).id !== listing.id);
    }) || new Set(body.result.map(item => (item as { id: string }).id)).size !== body.result.length)) throw new OfficialTradeError('invalid-response', 'Invalid Official Trade listing response');
    if (request.kind === 'stats' && body.result.some(category => !category || typeof category !== 'object' || !Array.isArray((category as { entries?: unknown }).entries) || (category as { entries: unknown[] }).entries.some(entry => !entry || typeof entry !== 'object' || ['id', 'text', 'type'].some(key => typeof (entry as Record<string, unknown>)[key] !== 'string')))) throw new OfficialTradeError('invalid-response', 'Invalid Official Trade stat metadata');
    if (request.kind === 'leagues' && body.result.some(league => !league || typeof league !== 'object' || Array.isArray(league) || typeof (league as { id?: unknown }).id !== 'string' || !(league as { id: string }).id)) throw new OfficialTradeError('invalid-response', 'Invalid Official Trade league metadata');
    const data = request.kind === 'fetch' ? body.result : body;
    return { source: 'official-trade', fetchedAt: new Date((this.options.now ?? Date.now)()).toISOString(), request, data };
  }
}
