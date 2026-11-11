import type { PoBLuaApiClient } from '../../adapters/pob/bridge.js';
import type { TradeApiClient } from '../../services/tradeClient.js';
import { compareItem } from './tool.js';
import { tradeClipboardText } from '../../domain/trade/clipboard.js';
export { tradeClipboardText } from '../../domain/trade/clipboard.js';

export async function compareTradeListing(trade: Pick<TradeApiClient, 'fetchItems'>, client: Pick<PoBLuaApiClient, 'compareItem'>, args: Record<string, unknown>) {
  const league = typeof args.league === 'string' ? args.league.trim() : '';
  const slot = typeof args.slot === 'string' ? args.slot.trim() : '';
  const itemId = typeof args.item_id === 'string' ? args.item_id.trim() : '';
  const searchId = typeof args.search_id === 'string' ? args.search_id.trim() : '';
  if (!league || league.length > 120 || !slot || !/^[0-9a-f]{64}$/i.test(itemId) || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(searchId)) {
    throw new Error('exact league, slot, listing item_id and search_id are required');
  }
  const listings = await trade.fetchItems([itemId], searchId);
  if (listings.length !== 1 || listings[0].id !== itemId) throw new Error('trade listing is missing or does not match item_id');
  const listing = listings[0];
  const text = tradeClipboardText(listing, league);
  const report = await compareItem(client, { slot, item_text: text });
  const price = listing.listing?.price;
  return { league, itemId, searchId, listingUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}#${itemId}`,
    price: price && Number.isFinite(price.amount) && price.amount > 0 && typeof price.currency === 'string' && price.currency ? { amount: price.amount, currency: price.currency, type: price.type } : null,
    listingVerified: listing.item.verified === true,
    ...report,
    warnings: [...report.warnings, 'Clipboard text and listing details come from the official trade API but may be cached; verify the listing and all item details before use.',
      'The original search status is not available to this tool: instant-buyout eligibility cannot be inferred from the listing price alone.'] };
}
