import type { PoBLuaApiClient } from '../../pobLuaBridge.js';
import type { TradeApiClient } from '../../services/tradeClient.js';
import { compareTradeListing } from './tradeListing.js';

type Success = { itemId: string; status: 'ok'; result: Awaited<ReturnType<typeof compareTradeListing>> };
type Failure = { itemId: string; status: 'error'; error: string };

export function validateTradeBatchArgs(args: Record<string, unknown>) {
  const league = typeof args.league === 'string' ? args.league.trim() : '';
  const slot = typeof args.slot === 'string' ? args.slot.trim() : '';
  const searchId = typeof args.search_id === 'string' ? args.search_id.trim() : '';
  const ids = args.item_ids;
  if (!league || league.length > 120 || !slot || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(searchId) ||
      !Array.isArray(ids) || ids.length < 1 || ids.length > 5 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id)) ||
      new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    throw new Error('exact league, slot, search_id and 1–5 distinct listing IDs are required');
  }
  return { league, slot, searchId, ids: ids as string[] };
}

/** One trade fetch, then bounded sequential previews in the supplied PoB engine. */
export async function compareTradeListings(trade: Pick<TradeApiClient, 'fetchItems'>, client: Pick<PoBLuaApiClient, 'compareItem'>, args: Record<string, unknown>) {
  const { league, slot, searchId, ids } = validateTradeBatchArgs(args);
  const listings = await trade.fetchItems(ids, searchId);
  const results: Array<Success | Failure> = [];
  // Isolate errors so one stale listing does not discard the other candidates.
  for (const itemId of ids) {
    try {
      const matches = listings.filter(listing => listing.id === itemId);
      const result = await compareTradeListing({ fetchItems: async () => matches }, client, { league, slot, item_id: itemId, search_id: searchId });
      results.push({ itemId, status: 'ok', result });
    } catch (error) {
      results.push({ itemId, status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
  const successful = results.filter((result): result is Success => result.status === 'ok');
  const canonical = (values: Record<string, number>) => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  const baselineStatsMatch = successful.length > 1 ? successful.every(result => canonical(result.result.baseline) === canonical(successful[0].result.baseline)) : null;
  return { league, slot, searchId, requestedCount: ids.length, completedCount: successful.length, baselineStatsMatch, results,
    warnings: [
      'Candidates are calculated sequentially against the live PoB build, in requested order, with no automatic ranking.',
      'baselineStatsMatch compares only returned numerical baseline stats; matching values do not prove the build or configuration was unchanged between calculations.',
      ...(baselineStatsMatch === false ? ['Baseline stats changed during the batch. Do not compare the candidates until the build is stable.'] : []),
      'Prices remain in their original currencies; listing details can be cached, and instant-buyout status is not inferred from price.',
    ] };
}
