import { isDeepStrictEqual } from 'node:util';
import type { OfficialTradeSource, TradeSourceResult } from '../../ports/officialTrade.js';
import type { ItemListing, StatData, TradeQuery } from '../../types/tradeTypes.js';

/** Per-workflow provenance; a shared source owns network, throttling and cache. */
export class TrackedTrade {
  readonly sourceTimes: Partial<Record<'stats' | 'search' | 'listings', string>> = {};
  readonly sourceFailures: Array<{ operation: string; message: string; code?: string; httpStatus?: number }> = [];
  missingIds: string[] = [];
  constructor(private readonly source: OfficialTradeSource) {}

  private validate(result: TradeSourceResult<unknown, unknown>): void {
    if (result.source !== 'official-trade' || typeof result.fetchedAt !== 'string' || !Number.isFinite(Date.parse(result.fetchedAt))) throw new Error('Official Trade returned invalid provenance');
  }
  private failure(operation: string, error: unknown): void {
    const failure = error as { message?: string; code?: string; httpStatus?: number };
    this.sourceFailures.push({ operation, message: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) });
  }
  async getStats(): Promise<StatData> {
    try {
      const result = await this.source.stats(); this.validate(result);
      if (result.request.kind !== 'stats') throw new Error('Official Trade returned mismatched stats provenance');
      this.sourceTimes.stats = result.fetchedAt; return result.data;
    } catch (error) { this.failure('stats', error); throw error; }
  }
  async searchItems(league: string, query: TradeQuery) {
    try {
      const result = await this.source.search(league, query); this.validate(result);
      if (result.request.league !== league || !isDeepStrictEqual(result.request.query, JSON.parse(JSON.stringify(query)))) throw new Error('Official Trade returned mismatched search provenance');
      this.sourceTimes.search = result.fetchedAt; return result.data;
    } catch (error) { this.failure('search', error); throw error; }
  }
  async fetchItems(ids: string[], queryId?: string): Promise<ItemListing[]> {
    if (!ids.length) return [];
    try {
      const result = await this.source.fetchListings(ids, queryId); this.validate(result);
      if (!isDeepStrictEqual(result.request.ids, ids) || result.request.queryId !== (queryId ?? null)) throw new Error('Official Trade returned mismatched listing provenance');
      this.sourceTimes.listings = result.fetchedAt; this.missingIds = result.data.missingIds;
      return result.data.listings;
    } catch (error) { this.failure('listings', error); throw error; }
  }
}
