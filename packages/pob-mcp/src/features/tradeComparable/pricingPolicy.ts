import { TradeQueryBuilder } from '../../domain/trade/queryBuilder.js';
import { auditStatSourceCoverage } from '../../domain/trade/sourceAudit.js';
import type { ItemListing, SearchResult, StatData, StatFilterGroup, TradeQuery } from '../../types/tradeTypes.js';
import { collectSourceStatistics } from './sourceStatistics.js';

interface ComparableClient {
  searchItems(league: string, query: TradeQuery): Promise<SearchResult>;
  fetchItems(ids: string[], queryId?: string): Promise<ItemListing[]>;
  getStats?(): Promise<StatData>;
}
type Filter = { stat_id: string; min?: number; max?: number };
type Group = { type: 'and' | 'or' | 'count'; filters: Filter[]; min?: number; max?: number };

export async function estimateComparable(client: ComparableClient, args: Record<string, unknown>) {
  if (Object.keys(args).some(key => !['league', 'base_type', 'stat_groups', 'limit'].includes(key))) throw new Error('unsupported comparable search option');
  const league = typeof args.league === 'string' ? args.league.trim() : '';
  const base = typeof args.base_type === 'string' ? args.base_type.trim() : '';
  const groups = args.stat_groups as Group[];
  if (!league || league.length > 100 || !base || base.length > 200 || !Array.isArray(groups) || !groups.length) throw new Error('league, base_type and at least one stat group are required');
  if (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)) throw new Error('limit must be an integer between 1 and 10');
  if (groups.length > 10 || groups.some(group => !group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['type', 'filters', 'min', 'max'].includes(key)) || !['and', 'or', 'count'].includes(group.type) || !Array.isArray(group.filters) || !group.filters.length || group.filters.length > 20 ||
    (group.min !== undefined && !Number.isFinite(group.min)) || (group.max !== undefined && !Number.isFinite(group.max)) ||
    (group.min !== undefined && group.max !== undefined && group.min > group.max) ||
    (group.type === 'count' && ([group.min, group.max].some(value => value !== undefined && (!Number.isInteger(value) || value < 0)) ||
      (group.min !== undefined && group.min > group.filters.length))) ||
    group.filters.some(filter => !filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).some(key => !['stat_id', 'min', 'max'].includes(key)) || typeof filter.stat_id !== 'string' || !filter.stat_id.trim() || filter.stat_id !== filter.stat_id.trim() || filter.stat_id.length > 200 ||
      (filter.min !== undefined && !Number.isFinite(filter.min)) || (filter.max !== undefined && !Number.isFinite(filter.max)) ||
      (filter.min !== undefined && filter.max !== undefined && filter.min > filter.max)))) {
    throw new Error('invalid stat_groups');
  }
  const normalized: StatFilterGroup[] = groups.map(group => ({ type: group.type,
    filters: group.filters.map(filter => ({ id: filter.stat_id, value: { min: filter.min, max: filter.max } })),
    ...(group.min !== undefined || group.max !== undefined ? { value: { min: group.min, max: group.max } } : {}),
  }));
  const sourceWarnings = client.getStats
    ? await auditStatSourceCoverage({ getStats: client.getStats.bind(client) }, normalized)
    : ['Official stat data is unavailable; source coverage could not be audited.'];
  const builder = new TradeQueryBuilder().withRarity('rare').withOnlineStatus('securable').withSaleType('priced').withStatGroups(normalized).withSort('price', 'asc');
  const query = builder.build();
  query.query.type = base;
  const search = await client.searchItems(league, query);
  const limit = (args.limit as number | undefined) ?? 10;
  const listings = await client.fetchItems((search.result ?? []).slice(0, limit), search.id);
  const sourceStatistics = collectSourceStatistics(listings, normalized.flatMap(group => group.filters.map(filter => filter.id)));
  const prices = new Map<string, number[]>();
  for (const item of listings) {
    const price = item.listing?.price;
    if (!price || !Number.isFinite(price.amount) || price.amount <= 0 || !price.currency) continue;
    const amounts = prices.get(price.currency) ?? [];
    amounts.push(price.amount);
    prices.set(price.currency, amounts);
  }
  const byCurrency = [...prices.entries()].map(([currency, amounts]) => {
    amounts.sort((a, b) => a - b);
    const midpoint = Math.floor(amounts.length / 2);
    return { currency, sampleCount: amounts.length, min: amounts[0], median: amounts.length % 2 ? amounts[midpoint] : amounts[midpoint - 1] / 2 + amounts[midpoint] / 2, max: amounts[amounts.length - 1] };
  });
  return { league, baseType: base, query, searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(search.id)}`,
    listingScope: 'instant_buyout', sourceWarnings, sourceStatistics, checkedAt: new Date().toISOString(), totalMatches: search.total, fetchedCount: listings.length, inexact: search.inexact === true, byCurrency,
    warnings: [...sourceWarnings, ...(search.inexact ? ['The official search reports inexact results; not every condition is guaranteed to match.'] : []),
      ...(groups.some(group => group.type === 'count' && group.min === 0) ? ['A count group explicitly permits zero matches, so its filters are not required to be present.'] : []),
      'The search targets instant-buyout listings matching the supplied conditions; sellers may be offline and listings may no longer be available. This is not an exact appraisal.',
      'checkedAt is report generation time; search and item details may be cached and it is not the market retrieval time.',
      'At most ten price-sorted listings are sampled; the median does not represent the entire market, and currencies are reported separately.',
      'Source counts match official hashes to query IDs and do not validate values. Conditions with hashComparable=false, including pseudo stats, cannot be counted this way; zero or missing hashes do not prove absence. listingsContainingSource may be unrelated to the query and a listing can count under multiple sources.',
      'Unspecified sources, values, base, corruption and other conditions can materially affect price.'] };
}
