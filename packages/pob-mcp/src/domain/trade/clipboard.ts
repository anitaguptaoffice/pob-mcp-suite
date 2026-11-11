import type { ItemListing } from '../../types/tradeTypes.js';

/** Decode the official clipboard payload without reconstructing or losing modifiers. */
export function tradeClipboardText(listing: Pick<ItemListing, 'item'>, league: string): string {
  const item = listing.item;
  if (!item || item.league !== league || item.identified !== true || typeof item.typeLine !== 'string' || !item.typeLine.trim()) throw new Error('listing item, league, identification, or type is not verified');
  const encoded = item.extended?.text;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('official clipboard text is missing or invalid');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10240 || bytes.toString('base64') !== encoded) throw new Error('official clipboard text is invalid or too large');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('official clipboard text is not valid UTF-8'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('official clipboard text contains invalid control characters');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  if (!lines.some(line => /^Item Class:\s*\S/i.test(line)) || !lines.some(line => /^Rarity:\s*\S/i.test(line)) || !lines.includes(item.typeLine.trim()) || (item.name && !lines.includes(item.name.trim()))) throw new Error('official clipboard text does not match listing identity');
  return text;
}
