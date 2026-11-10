import { collectSourceStatistics } from '../../src/features/tradeComparable/sourceStatistics.js';

describe('trade source statistics', () => {
  it('counts each requested ID separately, deduplicating IDs and repeated hashes per listing', () => {
    const report = collectSourceStatistics([
      { item: { extended: { hashes: { explicit: [['explicit.a', [0]], ['explicit.a', [1]], ['explicit.b', [2]]], fractured: [['fractured.a', [0]]] } } } },
      { item: { extended: { hashes: { explicit: [['explicit.b', [0]]] } } } },
      { item: {} },
    ], ['explicit.a', 'explicit.b', 'fractured.a', 'explicit.a', 'pseudo.a']);
    expect(report.sampleCount).toBe(3);
    expect(report.inspectableCount).toBe(2);
    expect(report.unavailableCount).toBe(1);
    expect(report.matchingListingsBySource.explicit).toBe(2);
    expect(report.listingsContainingSource.fractured).toBe(1);
    expect(report.byRequestedStat.map(stat => [stat.statId, stat.matchingListingsBySource.explicit, stat.matchingListingsBySource.fractured])).toEqual([
      ['explicit.a', 1, 0], ['explicit.b', 2, 0], ['fractured.a', 0, 1], ['pseudo.a', 0, 0],
    ]);
    expect(report.byRequestedStat.find(stat => stat.statId === 'pseudo.a')?.hashComparable).toBe(false);
  });

  it('reports absent hashes as unknown and does not infer pseudo matches', () => {
    const report = collectSourceStatistics([{}, { item: { extended: { hashes: {} } } }], ['pseudo.life']);
    expect(report.inspectableCount).toBe(0);
    expect(report.unavailableCount).toBe(2);
    expect(report.byRequestedStat[0].matchingListingsBySource.explicit).toBe(0);
  });
});
