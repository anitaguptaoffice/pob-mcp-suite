import { TradeQueryBuilder } from '../../domain/trade/queryBuilder.js';
import { auditStatSourceCoverage } from '../../domain/trade/sourceAudit.js';
import { collectSourceStatistics } from '../tradeComparable/sourceStatistics.js';
import { TrackedTrade } from '../tradeCommon/trackedTrade.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { ItemListing } from '../../types/tradeTypes.js';
import { classifyBuyoutEvidence, emptyBuyoutEvidenceCounts } from '../../domain/trade/buyoutEvidence.js';

const passiveIds = ['enchant.stat_3086156145', 'explicit.stat_3086156145'];
function modLines(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result = value.map(mod => typeof mod === 'string' ? mod : mod && typeof mod === 'object' && typeof mod.text === 'string' ? mod.text : mod && typeof mod === 'object' && typeof mod.description === 'string' ? mod.description : null);
  return result.some(value => value === null) ? null : result as string[];
}

export function clusterTradeSchema(): FeatureTool['schema'] {
  return { name: 'search_cluster_listings', description: 'Search securable cluster jewels and locally check enchant text and exact notable names within a bounded sample; the trade link represents the broader query.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    league: { type: 'string' }, jewel_size: { type: 'string', enum: ['large', 'medium', 'small'] }, passive_count: { type: 'integer', minimum: 1 }, min_item_level: { type: 'integer', minimum: 1 }, enchant: { type: 'string' }, notables: { type: 'array', maxItems: 10, items: { type: 'string' } }, max_price: { type: 'number', exclusiveMinimum: 0 }, price_currency: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 },
  }, required: ['league', 'jewel_size'] } };
}

export function createClusterTradeTool(source: OfficialTradeSource): FeatureTool {
  return { schema: clusterTradeSchema(), invoke: async args => {
    const keys = ['league', 'jewel_size', 'passive_count', 'min_item_level', 'enchant', 'notables', 'max_price', 'price_currency', 'limit'];
    if (Object.keys(args).some(key => !keys.includes(key)) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 || !['large', 'medium', 'small'].includes(args.jewel_size as string)) throw new Error('Exact league, jewel size and valid options are required');
    for (const key of ['passive_count', 'min_item_level']) if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || (args[key] as number) < 1)) throw new Error(`Invalid ${key}`);
    if (args.enchant !== undefined && (typeof args.enchant !== 'string' || !args.enchant.trim() || args.enchant.length > 200)) throw new Error('Invalid enchant text');
    const notables = args.notables ?? [];
    if (!Array.isArray(notables) || notables.length > 10 || notables.some(name => typeof name !== 'string' || !name.trim() || name.length > 200) || new Set(notables.map(name => name.trim().toLowerCase())).size !== notables.length) throw new Error('Invalid notable names');
    const limit = args.limit ?? 5, currency = args.price_currency ?? 'chaos';
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10 || typeof currency !== 'string' || !/^[a-z0-9-]{1,50}$/.test(currency.trim().toLowerCase()) || (args.max_price !== undefined && (typeof args.max_price !== 'number' || !Number.isFinite(args.max_price) || args.max_price <= 0))) throw new Error('Invalid price, currency or limit');
    const league = args.league.trim(), size = args.jewel_size as string, baseType = `${size[0].toUpperCase()}${size.slice(1)} Cluster Jewel`, unit = currency.trim().toLowerCase();
    const builder = new TradeQueryBuilder().withType(baseType).withOnlineStatus('securable').withSaleType('priced').withSort('price', 'asc');
    if (args.passive_count !== undefined) builder.withStatGroups([{ type: 'count', value: { min: 1 }, filters: passiveIds.map(id => ({ id, value: { min: args.passive_count as number, max: args.passive_count as number } })) }]);
    if (args.min_item_level !== undefined) builder.withItemLevel(args.min_item_level as number);
    if (args.max_price !== undefined || args.price_currency !== undefined) builder.withPriceRange(undefined, args.max_price as number | undefined, unit);
    const query = builder.build(), trade = new TrackedTrade(source);
    const sourceWarnings = await auditStatSourceCoverage(trade, query.query.stats);
    const sourceAudit = args.passive_count === undefined ? 'not_applicable' : trade.sourceFailures.some(failure => failure.operation === 'stats') ? 'unavailable' : 'completed';
    const search = await trade.searchItems(league, query);
    const selected = search.result.slice(0, Math.min(limit * 3, 30));
    const listings: ItemListing[] = [], missing: string[] = [], notAttempted: string[] = [];
    const fetches: Array<{ ids: string[]; fetchedAt?: string; error?: string; code?: string; httpStatus?: number }> = [];
    let rateLimited = false;
    for (let offset = 0; offset < selected.length; offset += 10) {
      const ids = selected.slice(offset, offset + 10);
      if (rateLimited) { notAttempted.push(...ids); continue; }
      try {
        const batch = await trade.fetchItems(ids, search.id);
        listings.push(...batch); missing.push(...trade.missingIds);
        fetches.push({ ids, fetchedAt: trade.sourceTimes.listings });
      } catch (error) {
        const failure = error as { message?: string; code?: string; httpStatus?: number };
        rateLimited = failure?.code === 'rate-limit' || failure?.httpStatus === 429;
        fetches.push({ ids, error: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) });
      }
    }
    const byId = new Map(listings.map(listing => [listing.id, listing]));
    const ordered = selected.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    let unknownMods = 0, excludedPrice = 0, excludedBudget = 0;
    const priceEvidenceCounts = emptyBuyoutEvidenceCounts();
    const matched = ordered.filter(entry => {
      const item = entry.item, price = entry.listing?.price;
      const evidence = classifyBuyoutEvidence(entry, league); priceEvidenceCounts[evidence]++;
      if (evidence !== 'explicit_buyout') { excludedPrice++; return false; }
      if (!item || item.typeLine !== baseType) return false;
      if (!price || ((args.max_price !== undefined || args.price_currency !== undefined) && price.currency !== unit) ||
          (args.max_price !== undefined && price.amount > (args.max_price as number))) { excludedPrice++; excludedBudget++; return false; }
      const enchantLines = [modLines(item.enchantMods), modLines(item.implicitMods)];
      const notableLines = [modLines(item.explicitMods), modLines(item.fracturedMods), modLines(item.craftedMods)];
      if ((args.enchant !== undefined && (enchantLines.some(lines => lines === null) || (item.enchantMods === undefined && item.implicitMods === undefined))) ||
          (notables.length && (notableLines.some(lines => lines === null) || (item.explicitMods === undefined && item.fracturedMods === undefined && item.craftedMods === undefined)))) { unknownMods++; return false; }
      if (typeof args.enchant === 'string' && !enchantLines.flatMap(lines => lines ?? []).some(line => line.toLowerCase().includes((args.enchant as string).trim().toLowerCase()))) return false;
      const names = notableLines.flatMap(lines => lines ?? []).flatMap(line => { const match = line.match(/^(?:\d+ Added Passive Skills? is|Allocates)\s+(.+)$/i); return match ? [match[1].trim().toLowerCase()] : []; });
      return notables.every(name => names.includes(name.trim().toLowerCase()));
    });
    const safe = matched.slice(0, limit).map(({ id, item, listing }) => ({ id, item, listing: { price: listing?.price, indexed: listing?.indexed, account: listing?.account ? { name: listing.account.name } : undefined } }));
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'official-trade', league, baseType, listingScope: 'instant_buyout', query, searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(search.id)}`,
      totalMatches: search.total, inexact: search.inexact === true, requestedCount: selected.length, fetchedCount: ordered.length, matchedCount: matched.length, returnedCount: safe.length, missingListingIds: missing, notAttemptedIds: notAttempted,
      localFilters: { enchant: args.enchant ?? null, notables }, unknownModCount: unknownMods, excludedPriceCount: excludedPrice, excludedBudgetCount: excludedBudget, priceEvidenceCounts, sourceAudit, sourceWarnings, sourceTimes: { stats: trade.sourceTimes.stats, search: trade.sourceTimes.search }, fetches, sourceFailures: trade.sourceFailures,
      sourceStatistics: collectSourceStatistics(ordered, args.passive_count === undefined ? [] : passiveIds), listings: safe,
      warnings: ['Enchant text and exact notable names are checked locally; the trade link represents only the broader query.', 'At most 30 search results are sampled; no match does not prove the market has none.', 'Source hashes do not prove modifier values or item legality; inexact search results require verification.', 'Only explicit buyouts with verified items in the requested league are returned. Evidence counts and source statistics cover all fetched listings, not just returned candidates. Evidence categories are mutually exclusive first-failure categories.', 'Listings and prices can become stale; only securable, priced searches are requested.'] }) }] };
  } };
}
