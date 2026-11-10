import { isDeepStrictEqual } from 'node:util';
import type { OfficialTradeSource, TradeSourceResult } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { ItemListing, StatData, TradeQuery } from '../../types/tradeTypes.js';
import { comparableQuerySchema } from './querySchema.js';
import { estimateComparable } from './pricingPolicy.js';

export function sourceComparableSchema(): FeatureTool['schema'] {
  return comparableQuerySchema('estimate_trade_comparable', 'Compare official international instant-buyout listings using confirmed base and stat groups. Reports retrieval times and source coverage; not an exact appraisal.');
}

/** Compose explicit pricing policy with the independently replaceable source. */
export function createSourceComparableTool(source: OfficialTradeSource): FeatureTool {
  return { schema: sourceComparableSchema(), invoke: async args => {
    const sourceTimes: Partial<Record<'stats' | 'search' | 'listings', string>> = {};
    const sourceFailures: Array<{ operation: string; message: string; code?: string; httpStatus?: number }> = [];
    let missingIds: string[] = [];
    const validate = (result: TradeSourceResult<unknown, unknown>) => {
      if (result.source !== 'official-trade' || typeof result.fetchedAt !== 'string' || !Number.isFinite(Date.parse(result.fetchedAt))) throw new Error('Official Trade returned invalid provenance');
    };
    const recordFailure = (operation: string, error: unknown) => {
      const failure = error as { message?: string; code?: string; httpStatus?: number };
      sourceFailures.push({ operation, message: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) });
    };
    const client = {
      getStats: async (): Promise<StatData> => {
        try {
          const result = await source.stats(); validate(result);
          if (result.request.kind !== 'stats') throw new Error('Official Trade returned mismatched stats provenance');
          sourceTimes.stats = result.fetchedAt; return result.data;
        } catch (error) { recordFailure('stats', error); throw error; }
      },
      searchItems: async (league: string, query: TradeQuery) => {
        try {
          const result = await source.search(league, query); validate(result);
          // JSON transport omits undefined optional filter bounds.
          if (result.request.league !== league || !isDeepStrictEqual(result.request.query, JSON.parse(JSON.stringify(query)))) throw new Error('Official Trade returned mismatched search provenance');
          sourceTimes.search = result.fetchedAt; return result.data;
        } catch (error) { recordFailure('search', error); throw error; }
      },
      fetchItems: async (ids: string[], queryId?: string): Promise<ItemListing[]> => {
        if (!ids.length) return [];
        try {
          const result = await source.fetchListings(ids, queryId); validate(result);
          if (!isDeepStrictEqual(result.request.ids, ids) || result.request.queryId !== (queryId ?? null)) throw new Error('Official Trade returned mismatched listing provenance');
          sourceTimes.listings = result.fetchedAt; missingIds = result.data.missingIds;
          return result.data.listings;
        } catch (error) { recordFailure('listings', error); throw error; }
      },
    };
    const report = await estimateComparable(client, args);
    return { content: [{ type: 'text', text: JSON.stringify({ ...report, source: 'official-trade', sourceTimes, sourceFailures, missingListingIds: missingIds,
      warnings: [...report.warnings, ...(missingIds.length ? ['Some requested listings were unavailable at fetch time; sample statistics are partial.'] : [])] }) }] };
  } };
}
