export type BuyoutEvidence = 'explicit_buyout' | 'invalid_price' | 'unconfirmed_buyout' | 'unverified_item' | 'league_unconfirmed';

/** Classify fetched listing evidence independently of the search filters. */
export function classifyBuyoutEvidence(value: { item?: { verified?: unknown; league?: unknown }; listing?: { price?: { type?: unknown; amount?: unknown; currency?: unknown } } }, league: string): BuyoutEvidence {
  const price = value.listing?.price;
  if (!price || typeof price.amount !== 'number' || !Number.isFinite(price.amount) || price.amount <= 0 || typeof price.currency !== 'string' || !price.currency.trim() || price.currency !== price.currency.trim()) return 'invalid_price';
  if (price.type !== '~b/o') return 'unconfirmed_buyout';
  if (value.item?.verified !== true) return 'unverified_item';
  if (value.item.league !== league) return 'league_unconfirmed';
  return 'explicit_buyout';
}

export function emptyBuyoutEvidenceCounts(): Record<BuyoutEvidence, number> {
  return { explicit_buyout: 0, invalid_price: 0, unconfirmed_buyout: 0, unverified_item: 0, league_unconfirmed: 0 };
}
