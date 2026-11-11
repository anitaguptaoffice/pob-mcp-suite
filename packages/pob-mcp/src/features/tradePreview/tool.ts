import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { tradeClipboardText } from '../../domain/trade/clipboard.js';
import { fetchVerifiedListingBatch } from '../tradeCommon/listingFetch.js';

export function tradePreviewSchema(): FeatureTool['schema'] {
  return { name: 'preview_trade_listings', description: 'Fetch up to five official trade listings and compare each exact clipboard item against an immutable PoB snapshot. No ranking, legality or instant-buyout eligibility is inferred.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, league: { type: 'string' }, slot: { type: 'string' }, search_id: { type: 'string' }, item_ids: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } } }, required: ['snapshot_id', 'league', 'slot', 'search_id', 'item_ids'] } };
}

export function createTradePreviewTool(foundation: Pick<BuildFoundation, 'previewItem' | 'readSnapshot'>, trade: OfficialTradeSource): FeatureTool {
  return { schema: tradePreviewSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'league', 'slot', 'search_id', 'item_ids'].includes(key)) ||
        typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 ||
        typeof args.slot !== 'string' || !args.slot.trim() || args.slot.length > 100 || typeof args.search_id !== 'string' || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(args.search_id) ||
        !Array.isArray(args.item_ids) || args.item_ids.length < 1 || args.item_ids.length > 5 || args.item_ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id)) || new Set(args.item_ids.map(id => id.toLowerCase())).size !== args.item_ids.length) throw new Error('Valid snapshot, exact league, slot, search ID and 1–5 distinct listing IDs are required');
    const league = args.league.trim(), slot = args.slot.trim(), searchId = args.search_id, ids = (args.item_ids as string[]).map(id => id.toLowerCase()), snapshotId = args.snapshot_id;
    const snapshot = await foundation.readSnapshot(snapshotId);
    if (!snapshot || snapshot.id !== snapshotId) throw new Error('Snapshot identity mismatch');
    const fetched = await fetchVerifiedListingBatch(trade, ids, searchId);
    const map = fetched.listings;
    const results = [];
    for (const itemId of ids) {
      try {
        const listing = map.get(itemId);
        if (!listing) throw new Error('Trade listing is missing');
        const text = tradeClipboardText(listing, league);
        const preview = await foundation.previewItem(snapshotId, slot, text);
        const price = listing.listing?.price;
        results.push({ itemId, status: 'ok', listingVerified: listing.item.verified === true,
          price: price && typeof price.amount === 'number' && Number.isFinite(price.amount) && price.amount > 0 && typeof price.currency === 'string' && price.currency.trim() ? { amount: price.amount, currency: price.currency, type: typeof price.type === 'string' ? price.type : null } : null,
          clipboardText: text, preview });
      } catch (error) { results.push({ itemId, status: 'error', error: error instanceof Error ? error.message : String(error) }); }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, league, slot, searchId, source: fetched.source, fetchedAt: fetched.fetchedAt,
      searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}`, requestedCount: ids.length, completedCount: results.filter(result => result.status === 'ok').length, results,
      warnings: ['Listings may be cached or unavailable; search status and instant-buyout eligibility cannot be inferred from a price.', 'Previews use one immutable snapshot, but candidate legality, socket requirements, parsing completeness and market availability require verification.'] }) }] };
  } };
}
