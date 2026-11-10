import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { fetchVerifiedListingBatch } from '../tradeCommon/listingFetch.js';

export function tradeListingComparisonSchema(): FeatureTool['schema'] {
  return { name: 'compare_official_trade_listings', description: 'Compare raw official Trade listings by ID, with source time and missing entries. No PoB gain, price conversion or instant-buyout eligibility is inferred.', inputSchema: { type: 'object', additionalProperties: false, properties: { league: { type: 'string' }, search_id: { type: 'string' }, item_ids: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string' } } }, required: ['league', 'item_ids'] } };
}

export function createTradeListingComparisonTool(source: OfficialTradeSource): FeatureTool {
  return { schema: tradeListingComparisonSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['league', 'search_id', 'item_ids'].includes(key)) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 ||
      (args.search_id !== undefined && (typeof args.search_id !== 'string' || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(args.search_id))) || !Array.isArray(args.item_ids) || args.item_ids.length < 1 || args.item_ids.length > 5 || args.item_ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id)) || new Set(args.item_ids.map(id => id.toLowerCase())).size !== args.item_ids.length) throw new Error('Exact league, optional search ID and 1–5 distinct listing IDs are required');
    const league = args.league.trim(), searchId = args.search_id as string | undefined, ids = args.item_ids.map(id => id.toLowerCase()) as string[];
    const fetched = await fetchVerifiedListingBatch(source, ids, searchId);
    const results = ids.map(itemId => {
      const listing = fetched.listings.get(itemId);
      if (!listing) return { itemId, status: 'missing' };
      const item = listing.item;
      if (!item || typeof item !== 'object') return { itemId, status: 'invalid_item' };
      const listingLeague = typeof item.league === 'string' && item.league ? item.league : null;
      const leagueStatus = listingLeague === null ? 'unknown' : listingLeague === league ? 'match' : 'mismatch';
      const price = listing.listing?.price;
      const validPrice = price && typeof price.amount === 'number' && Number.isFinite(price.amount) && price.amount > 0 && typeof price.currency === 'string' && price.currency.trim();
      const account = listing.listing?.account;
      return { itemId, status: leagueStatus === 'mismatch' ? 'league_mismatch' : 'ok', leagueStatus, listingLeague,
        verified: typeof item.verified === 'boolean' ? item.verified : null,
        price: validPrice ? { amount: price.amount, currency: price.currency, type: typeof price.type === 'string' ? price.type : null } : null,
        indexed: typeof listing.listing?.indexed === 'string' ? listing.listing.indexed : null,
        seller: account ? { name: typeof account.name === 'string' ? account.name : null, online: account.online ? true : null, onlineLeague: typeof account.online?.league === 'string' ? account.online.league : null } : null,
        item };
    });
    return { content: [{ type: 'text', text: JSON.stringify({ source: fetched.source, fetchedAt: fetched.fetchedAt, league, searchId: searchId ?? null,
      searchUrl: searchId ? `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}` : null,
      requestedCount: ids.length, missingListingIds: fetched.missingIds, results,
      listingScope: 'unknown', warnings: ['Raw listing prices do not establish securable status or instant-buyout eligibility; use a securable priced search for purchase screening.', 'Prices are asking prices in their original currencies; no currency conversion, PoB calculation, ranking or legality check was performed.', 'Seller online status and listing availability may have changed since the source retrieval time.'] }) }] };
  } };
}
