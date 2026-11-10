import { describe, expect, it, jest } from '@jest/globals';
import { estimateBuildCost, matchGem, matchUnique } from '../../src/features/buildCost/estimate.js';
import { NinjaPrices, type PriceCategory } from '../../src/features/buildCost/ninjaPrices.js';

const unique = { slot: 'Helmet', id: 1, rarity: 'UNIQUE', name: 'Example', baseName: 'Circlet', raw: 'Rarity: UNIQUE\nExample\nCirclet' };
const line = { name: 'Example', baseType: 'Circlet', chaosValue: 12, listingCount: 15 };
const source = { get: async (_league: string, category: PriceCategory) => ({ fetchedAt: '2026-01-01T00:00:00.000Z', lines: category === 'UniqueArmour' ? [line] : [] }) };

describe('build cost matching', () => {
  it('excludes disabled gems and skill groups from the subtotal', async () => {
    const gem = { name: 'Vortex', level: 20, quality: 0, enabled: true };
    const market = { get: async () => ({ fetchedAt: '2026-01-01', lines: [{ name: 'Vortex', gemLevel: 20, chaosValue: 10 }] }) };
    const report = await estimateBuildCost(market, 'Standard', [], [
      { index: 1, enabled: false, gems: [gem] }, { index: 2, enabled: true, gems: [{ ...gem, enabled: false }] },
    ]);
    expect(report.estimatedSubtotal).toBe(0);
    expect(report.unknownCount).toBe(2);
  });
  it('requires both name and base, and refuses special or ambiguous unique variants', () => {
    expect(matchUnique(unique, [line]).line?.chaosValue).toBe(12);
    expect(matchUnique({ ...unique, baseName: 'Other' }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, raw: unique.raw + '\nCorrupted' }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, name: 'Elegant Hubris' }, [{ ...line, name: 'Elegant Hubris' }]).line).toBeUndefined();
    expect(matchUnique(unique, [line, { ...line, links: 6 }]).line).toBeUndefined();
  });

  it('does not silently select a cheaper corrupted gem with the same level and quality', () => {
    const gem = { name: 'Vortex', level: 20, quality: 20, enabled: true };
    expect(matchGem(gem, [
      { name: 'Vortex', gemLevel: 20, gemQuality: 20, chaosValue: 40 },
      { name: 'Vortex', gemLevel: 20, gemQuality: 20, chaosValue: 3, corrupted: true },
    ]).line).toBeUndefined();
  });

  it('matches the support suffix only when PoB identifies a support gem', () => {
    const gem = { name: 'Second Wind', level: 20, quality: 0, enabled: true, isSupport: true };
    const listings = [{ name: 'Second Wind Support', gemLevel: 20, chaosValue: 2 }];
    expect(matchGem(gem, listings).line?.chaosValue).toBe(2);
    expect(matchGem({ ...gem, isSupport: false }, listings).line).toBeUndefined();
  });

  it('reports unknown items separately and never presents the subtotal as complete', async () => {
    const report = await estimateBuildCost(source, 'Standard', [unique,
      { slot: 'Boots', id: 2, rarity: 'RARE', name: 'Rare boots' },
      { slot: 'Weapon 2', id: 3, rarity: 'UNIQUE', name: 'Other', shown: false },
    ], [{ index: 1, gems: [{ name: 'Vortex', level: 20, quality: 0, enabled: true }] }]);
    expect(report.estimatedSubtotal).toBe(12);
    expect(report.pricedCount).toBe(1);
    expect(report.unknownCount).toBe(2);
    expect(report.complete).toBe(false);
    expect(report.entries.find(entry => entry.name === 'Rare boots')?.chaos).toBeUndefined();
    expect(report.warnings.join(' ')).toContain('未知物品未计入');
  });

  it('does not treat a failed category as an empty market', async () => {
    const report = await estimateBuildCost({ get: async (league, category) => {
      if (category === 'UniqueWeapon') throw new Error('unavailable');
      return source.get(league, category);
    } }, 'Standard', [unique], []);
    expect(report.unknownCount).toBe(1);
    expect(report.entries[0].chaos).toBeUndefined();
    expect(report.warnings.join(' ')).toContain('UniqueWeapon');
  });
});

describe('ninja cache', () => {
  it('deduplicates in-flight requests and caches successful responses by league and category', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ lines: [line] }), { status: 200 }));
    let now = 0;
    const prices = new NinjaPrices(fetcher as unknown as typeof fetch, () => now);
    await Promise.all([prices.get('Standard', 'UniqueArmour'), prices.get('Standard', 'UniqueArmour')]);
    await prices.get('Standard', 'UniqueArmour');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await prices.get('Other League', 'UniqueArmour');
    now = 600_001;
    await prices.get('Standard', 'UniqueArmour');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
