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
  const sourceCoverage = Object.fromEntries(sources.map(source => [source, { availableListings: 0, missingListings: 0, malformedListings: 0, completeWithinSample: false }])) as Record<Source, { availableListings: number; missingListings: number; malformedListings: number; completeWithinSample: boolean }>;
  const byRequestedStat = ids.map(statId => ({ statId,
    hashComparable: sources.some(source => statId.startsWith(`${source}.`)),
    matchingListingsBySource: emptyCounts() }));
  let inspectableCount = 0;

  for (const listing of listings) {
    const hashes = listing.item?.extended?.hashes;
    if (hashes && typeof hashes === 'object' && sources.some(source => Array.isArray(hashes[source]))) inspectableCount++;
    for (const source of sources) {
      const entries: unknown = hashes && typeof hashes === 'object' ? hashes[source] : undefined;
      if (entries === undefined || entries === null) { sourceCoverage[source].missingListings++; continue; }
      if (!Array.isArray(entries)) { sourceCoverage[source].malformedListings++; continue; }
      const valid = entries.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && !!entry[0].trim());
      if (valid.length !== entries.length) sourceCoverage[source].malformedListings++;
      else sourceCoverage[source].availableListings++;
      if (valid.length) listingsContainingSource[source]++;
      const present = new Set(valid.map(entry => entry[0]));
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
  for (const source of sources) sourceCoverage[source].completeWithinSample = listings.length > 0 && sourceCoverage[source].availableListings === listings.length;
  return { sampleCount: listings.length, inspectableCount, unavailableCount: listings.length - inspectableCount,
    matchingListingsBySource, listingsContainingSource, sourceCoverage, byRequestedStat };
}
