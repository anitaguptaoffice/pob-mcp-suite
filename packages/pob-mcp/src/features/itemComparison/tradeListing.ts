import type { PoBLuaApiClient } from '../../pobLuaBridge.js';
import type { TradeApiClient } from '../../services/tradeClient.js';
import type { ItemListing } from '../../types/tradeTypes.js';
import { compareItem } from './tool.js';

/** Decode the official clipboard payload without reconstructing or losing modifiers. */
export function tradeClipboardText(listing: ItemListing, league: string): string {
  const item = listing.item;
  if (!item || item.league !== league || item.identified !== true || typeof item.typeLine !== 'string' || !item.typeLine.trim()) {
    throw new Error('listing item, league, identification, or type is not verified');
  }
  const encoded = item.extended?.text;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('official clipboard text is missing or invalid');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10240 || bytes.toString('base64') !== encoded) throw new Error('official clipboard text is invalid or too large');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('official clipboard text is not valid UTF-8'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('official clipboard text contains invalid control characters');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  if (!lines.some(line => /^Item Class:\s*\S/i.test(line)) || !lines.some(line => /^Rarity:\s*\S/i.test(line)) ||
      !lines.includes(item.typeLine.trim()) || (item.name && !lines.includes(item.name.trim()))) {
    throw new Error('official clipboard text does not match listing identity');
  }
  return text;
}

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
