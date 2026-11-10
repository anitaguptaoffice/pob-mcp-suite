import { TradeQueryBuilder } from '../../domain/trade/queryBuilder.js';
import { auditStatSourceCoverage } from '../../domain/trade/sourceAudit.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { StatFilterGroup, TradeStatus } from '../../types/tradeTypes.js';
import { collectSourceStatistics } from '../tradeComparable/sourceStatistics.js';
import { TrackedTrade } from '../tradeCommon/trackedTrade.js';

const statusValues = ['securable', 'available', 'online', 'onlineleague', 'any'] as const;
const rarityValues = ['normal', 'magic', 'rare', 'unique', 'any'] as const;
const saleValues = ['priced', 'unpriced', 'any'] as const;

export function tradeSearchSchema(): FeatureTool['schema'] {
  const statFilter = { type: 'object', additionalProperties: false, properties: { stat_id: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } }, required: ['stat_id'] };
  return { name: 'search_official_trade', description: 'Search official international PoE 1 listings. Defaults to securable priced listings and reports exact query, source times, missing results and stat-source coverage.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    league: { type: 'string' }, item_name: { type: 'string' }, item_type: { type: 'string' }, item_rarity: { type: 'string', enum: [...rarityValues] },
    min_price: { type: 'number', minimum: 0 }, max_price: { type: 'number', minimum: 0 }, price_currency: { type: 'string' },
    status: { type: 'string', enum: [...statusValues] }, sale_type: { type: 'string', enum: [...saleValues] },
    min_links: { type: 'integer', minimum: 1, maximum: 6 }, corrupted: { type: 'boolean' }, identified: { type: 'boolean' },
    mods: { type: 'array', items: statFilter }, stat_groups: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      type: { type: 'string', enum: ['and', 'or', 'not', 'count', 'weight'] }, filters: { type: 'array', items: statFilter }, min: { type: 'number' }, max: { type: 'number' },
    }, required: ['type', 'filters'] } }, audit_sources: { type: 'boolean' },
    sort: { type: 'string', enum: ['price_asc', 'price_desc'] }, limit: { type: 'integer', minimum: 1, maximum: 10 },
  }, required: ['league'] } };
}

type Filter = { stat_id: string; min?: number; max?: number };
type Group = { type: 'and' | 'or' | 'not' | 'count' | 'weight'; filters: Filter[]; min?: number; max?: number };

/** Application workflow returns structured data independently of MCP. */
export async function searchOfficialTrade(source: OfficialTradeSource, args: Record<string, unknown>) {
    const allowed = new Set(['league', 'item_name', 'item_type', 'item_rarity', 'min_price', 'max_price', 'price_currency', 'status', 'sale_type', 'min_links', 'corrupted', 'identified', 'mods', 'stat_groups', 'audit_sources', 'sort', 'limit']);
    if (Object.keys(args).some(key => !allowed.has(key))) throw new Error('Unsupported trade search option');
    const league = typeof args.league === 'string' ? args.league.trim() : '';
    const status = args.status ?? 'securable';
    const sale = args.sale_type ?? 'priced';
    const sort = args.sort ?? 'price_asc';
    const limit = args.limit ?? 5;
    if (!league || league.length > 100 || !statusValues.includes(status as TradeStatus) || !saleValues.includes(sale as typeof saleValues[number]) || !['price_asc', 'price_desc'].includes(sort as string) ||
        typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid league, status, sale type, sort or limit');
    for (const key of ['item_name', 'item_type', 'price_currency']) if (args[key] !== undefined && (typeof args[key] !== 'string' || !(args[key] as string).trim() || (args[key] as string).length > 200)) throw new Error(`Invalid ${key}`);
    for (const key of ['corrupted', 'identified', 'audit_sources']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`Invalid ${key}`);
    if (args.item_rarity !== undefined && !rarityValues.includes(args.item_rarity as typeof rarityValues[number])) throw new Error('Invalid item_rarity');
    if (args.min_links !== undefined && (typeof args.min_links !== 'number' || !Number.isInteger(args.min_links) || args.min_links < 1 || args.min_links > 6)) throw new Error('Invalid min_links');
    for (const key of ['min_price', 'max_price']) if (args[key] !== undefined && (typeof args[key] !== 'number' || !Number.isFinite(args[key]) || (args[key] as number) < 0)) throw new Error(`Invalid ${key}`);
    if (typeof args.min_price === 'number' && typeof args.max_price === 'number' && args.min_price > args.max_price) throw new Error('Invalid price range');
    if (sale === 'unpriced' && (status === 'securable' || args.min_price !== undefined || args.max_price !== undefined || args.price_currency !== undefined)) throw new Error('Unpriced listings cannot use securable status or a price filter');
    const validFilter = (filter: Filter) => !!filter && typeof filter === 'object' && !Array.isArray(filter) && Object.keys(filter).every(key => ['stat_id', 'min', 'max'].includes(key)) &&
      typeof filter.stat_id === 'string' && !!filter.stat_id.trim() && filter.stat_id === filter.stat_id.trim() && filter.stat_id.length <= 200 &&
      [filter.min, filter.max].every(value => value === undefined || (typeof value === 'number' && Number.isFinite(value))) &&
      (filter.min === undefined || filter.max === undefined || filter.min <= filter.max);
    if (args.mods !== undefined && (!Array.isArray(args.mods) || args.mods.length > 20 || args.mods.some(filter => !validFilter(filter)))) throw new Error('Invalid mods');
    if (args.stat_groups !== undefined && (!Array.isArray(args.stat_groups) || args.stat_groups.length > 10 || args.stat_groups.some((group: Group) => !group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['type', 'filters', 'min', 'max'].includes(key)) || !['and', 'or', 'not', 'count', 'weight'].includes(group.type) ||
        !Array.isArray(group.filters) || !group.filters.length || group.filters.length > 20 || group.filters.some(filter => !validFilter(filter)) ||
        [group.min, group.max].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) ||
        (group.min !== undefined && group.max !== undefined && group.min > group.max) ||
        (group.type === 'count' && ([group.min, group.max].some(value => value !== undefined && (!Number.isInteger(value) || value < 0)) || (group.min !== undefined && group.min > group.filters.length)))))) throw new Error('Invalid stat_groups');

    const builder = new TradeQueryBuilder().withOnlineStatus(status as TradeStatus).withSaleType(sale as typeof saleValues[number]);
    if (args.item_name) builder.withName((args.item_name as string).trim());
    if (args.item_type) builder.withType((args.item_type as string).trim());
    if (args.item_rarity) builder.withRarity(args.item_rarity as typeof rarityValues[number]);
    if (args.min_links !== undefined) builder.withLinks(args.min_links as number);
    if (args.corrupted !== undefined) builder.withCorrupted(args.corrupted as boolean);
    if (args.identified !== undefined) builder.withIdentified(args.identified as boolean);
    if (args.min_price !== undefined || args.max_price !== undefined || args.price_currency !== undefined) builder.withPriceRange(args.min_price as number | undefined, args.max_price as number | undefined, (args.price_currency as string | undefined)?.trim() ?? 'chaos');
    if (Array.isArray(args.mods) && args.mods.length) builder.withStats((args.mods as Filter[]).map(filter => ({ id: filter.stat_id, min: filter.min, max: filter.max })));
    if (Array.isArray(args.stat_groups) && args.stat_groups.length) builder.withStatGroups((args.stat_groups as Group[]).map(group => ({ type: group.type,
      filters: group.filters.map(filter => ({ id: filter.stat_id, value: { min: filter.min, max: filter.max } })),
      ...(group.min !== undefined || group.max !== undefined ? { value: { min: group.min, max: group.max } } : {}),
    } as StatFilterGroup)));
    builder.withSort('price', sort === 'price_desc' ? 'desc' : 'asc');
    const query = builder.build();
    const trade = new TrackedTrade(source);
    const sourceWarnings = args.audit_sources === false ? [] : await auditStatSourceCoverage(trade, query.query.stats, args.item_name as string | undefined);
    const hasStatFilters = (query.query.stats ?? []).some(group => group.filters.length > 0);
    const sourceAudit = !hasStatFilters ? 'not_applicable' : args.audit_sources === false ? 'not_requested'
      : args.item_name ? 'skipped_named_item' : trade.sourceFailures.some(failure => failure.operation === 'stats') ? 'unavailable' : 'completed';
    const search = await trade.searchItems(league, query);
    const selectedIds = search.result.slice(0, limit);
    const fetched = await trade.fetchItems(selectedIds, search.id);
    const byId = new Map(fetched.map(listing => [listing.id, listing]));
    const ordered = selectedIds.flatMap(id => { const listing = byId.get(id); return listing ? [listing] : []; });
    const statistics = collectSourceStatistics(ordered, (query.query.stats ?? []).flatMap(group => group.filters.map(filter => filter.id)));
    const listings = ordered.map(({ id, item, listing }) => ({ id, item, listing: { price: listing?.price, indexed: listing?.indexed, account: listing?.account ? { name: listing.account.name } : undefined } }));
    const warnings = [...sourceWarnings,
      ...(sourceAudit === 'skipped_named_item' ? ['Stat source coverage was not audited for the named item; verify applicable sources separately.'] : []),
      ...(search.inexact ? ['The official search reports inexact results; not every condition is guaranteed to match.'] : []),
      ...(trade.missingIds.length ? ['Some requested listings were unavailable at fetch time; results are partial.'] : []),
      'Results are asking prices, not completed sales; listing availability can change.',
      'Source counts match official hashes to query IDs and do not verify values. Missing hashes and pseudo stats cannot establish source absence.',
    ];
    return { source: 'official-trade' as const, league, query, searchId: search.id, listingScope: status === 'securable' && sale === 'priced' ? 'instant_buyout' as const : 'other' as const,
      searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(search.id)}`, totalMatches: search.total, inexact: search.inexact === true,
      requestedCount: selectedIds.length, fetchedCount: listings.length, missingListingIds: trade.missingIds, listings, sourceStatistics: statistics, sourceAudit, sourceWarnings,
      sourceTimes: trade.sourceTimes, sourceFailures: trade.sourceFailures, warnings };
}

export function createTradeSearchTool(source: OfficialTradeSource): FeatureTool {
  return { schema: tradeSearchSchema(), invoke: async args => ({ content: [{ type: 'text', text: JSON.stringify(await searchOfficialTrade(source, args)) }] }) };
}
