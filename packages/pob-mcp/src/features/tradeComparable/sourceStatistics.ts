const sources = ['explicit', 'implicit', 'fractured', 'crafted', 'enchant'] as const;
type Source = typeof sources[number];
type Hashes = Partial<Record<Source, Array<[string, number[]]>>>;
type Listing = { item?: { extended?: { hashes?: Hashes } } };

const emptyCounts = (): Record<Source, number> => ({ explicit: 0, implicit: 0, fractured: 0, crafted: 0, enchant: 0 });

/** Count listings, not individual lines or affixes. Hash IDs alone do not verify values. */
export function collectSourceStatistics(listings: Listing[], requestedIds: Iterable<string>) {
  const ids = [...new Set(requestedIds)];
  const matchingListingsBySource = emptyCounts();
  const listingsContainingSource = emptyCounts();
  const byRequestedStat = ids.map(statId => ({ statId,
    hashComparable: sources.some(source => statId.startsWith(`${source}.`)),
    matchingListingsBySource: emptyCounts() }));
  let inspectableCount = 0;

  for (const listing of listings) {
    const hashes = listing.item?.extended?.hashes;
    if (!hashes || typeof hashes !== 'object' || !sources.some(source => Array.isArray(hashes[source]))) continue;
    inspectableCount++;
    for (const source of sources) {
      const entries = hashes[source];
      if (!Array.isArray(entries)) continue;
      if (entries.length) listingsContainingSource[source]++;
      const present = new Set(entries.filter(Array.isArray).map(entry => entry[0]));
      let anyMatched = false;
      for (const stat of byRequestedStat) {
        if (present.has(stat.statId)) {
          stat.matchingListingsBySource[source]++;
          anyMatched = true;
        }
      }
      if (anyMatched) matchingListingsBySource[source]++;
    }
  }
  return { sampleCount: listings.length, inspectableCount, unavailableCount: listings.length - inspectableCount,
    matchingListingsBySource, listingsContainingSource, byRequestedStat };
}
