import { isDeepStrictEqual } from 'node:util';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';

/** Fetch a bounded set, validating provenance and preserving missing IDs and request order. */
export async function fetchVerifiedListingBatch(source: Pick<OfficialTradeSource, 'fetchListings'>, ids: string[], searchId?: string) {
  const fetched = await source.fetchListings(ids, searchId);
  if (fetched.source !== 'official-trade' || fetched.request.queryId !== (searchId ?? null) || !isDeepStrictEqual(fetched.request.ids, ids) || typeof fetched.fetchedAt !== 'string' || !Number.isFinite(Date.parse(fetched.fetchedAt)) || !Array.isArray(fetched.data?.listings) || !Array.isArray(fetched.data?.missingIds)) throw new Error('Trade source returned mismatched provenance');
  const map = new Map(fetched.data.listings.map(listing => [listing.id, listing]));
  if (map.size !== fetched.data.listings.length || [...map.keys()].some(id => !ids.includes(id)) || fetched.data.listings.some(listing => typeof listing.item?.id === 'string' && listing.item.id !== listing.id) || !isDeepStrictEqual(fetched.data.missingIds, ids.filter(id => !map.has(id)))) throw new Error('Trade source returned inconsistent listings');
  return { source: fetched.source, fetchedAt: fetched.fetchedAt, missingIds: fetched.data.missingIds, listings: map };
}
