import { describe, expect, it, jest } from '@jest/globals';
import { estimateBuildCost, matchGem, matchUnique } from '../../src/features/buildCost/estimate.js';
import type { PriceCategory } from '../../src/features/buildCost/priceTypes.js';

const unique = { slot: 'Helmet', id: 1, rarity: 'UNIQUE', name: 'Example', baseName: 'Circlet', raw: 'Rarity: UNIQUE\nExample\nCirclet' };
const line = { name: 'Example', baseType: 'Circlet', chaosValue: 12, listingCount: 15 };
const source = { get: async (_league: string, category: PriceCategory) => ({ fetchedAt: '2026-01-01T00:00:00.000Z', lines: category === 'UniqueArmour' ? [line] : [] }) };

describe('build cost matching', () => {
  it('prices a confirmed unique from the market reference', async () => {
    const report = await estimateBuildCost(source, 'Standard', [unique], []);
    expect(report.estimatedSubtotal).toBe(12);
  });

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

  it('does not apply a generic unique price to linked or specially modified actual items', () => {
    expect(matchUnique({ ...unique, raw: `${unique.raw}\nSockets: R-R-R-R-R-R` }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, raw: `${unique.raw}\nSockets: R-R-R-R-R B` }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, raw: `${unique.raw}\n{crafted}Allocates Test` }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, raw: `${unique.raw}\n{enchant}Special effect` }, [line]).line).toBeUndefined();
    expect(matchUnique({ ...unique, raw: `${unique.raw}\nSockets: R-R-R-R B-B` }, [line]).line?.chaosValue).toBe(12);
  });

  it('does not silently select a cheaper corrupted gem with the same level and quality', () => {
    const gem = { name: 'Vortex', level: 20, quality: 20, enabled: true };
    expect(matchGem(gem, [
      { name: 'Vortex', gemLevel: 20, gemQuality: 20, chaosValue: 40 },
      { name: 'Vortex', gemLevel: 20, gemQuality: 20, chaosValue: 3, corrupted: true },
    ]).line).toBeUndefined();
  });

  it('does not price an unconfirmed corrupted or non-default-quality gem', () => {
    const gem = { name: 'Raise Spectre', level: 21, quality: 20, enabled: true, qualityId: 'Default' };
    // Real poe.ninja shape: Standard has a 21/20c entry and no non-corrupted 21/20 listing.
    const corrupted = { name: 'Raise Spectre', gemLevel: 21, gemQuality: 20, chaosValue: 3007, corrupted: true, variant: '21/20c' };
    expect(matchGem(gem, [corrupted]).line).toBeUndefined();
    expect(matchGem(gem, [{ ...corrupted, corrupted: undefined }]).line).toBeUndefined();
    expect(matchGem({ ...gem, level: 20, qualityId: 'Alternate1' }, [
      { name: 'Raise Spectre', gemLevel: 20, gemQuality: 20, chaosValue: 433.5, variant: '20/20' },
    ]).line).toBeUndefined();
  });

  it('excludes an unconfirmed corrupted gem from the reference subtotal', async () => {
    const market = { get: async () => ({ fetchedAt: '2026-01-01', lines: [
      { name: 'Raise Spectre', gemLevel: 21, gemQuality: 20, chaosValue: 3007, corrupted: true, variant: '21/20c' },
    ] }) };
    const report = await estimateBuildCost(market, 'Standard', [], [{ index: 1, slotEnabled: true, gems: [
      { name: 'Raise Spectre', level: 21, quality: 20, qualityId: 'Default', enabled: true },
    ] }]);
    expect(report.estimatedSubtotal).toBe(0);
    expect(report.entries[0].status).toBe('unknown');
    expect(report.entries[0].note).toContain('corrupt');
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
    ], [{ index: 1, slotEnabled: true, gems: [{ name: 'Vortex', level: 20, quality: 0, enabled: true }] }]);
    expect(report.estimatedSubtotal).toBe(12);
    expect(report.pricedCount).toBe(1);
    expect(report.unknownCount).toBe(2);
    expect(report.complete).toBe(false);
    expect(report.entries.find(entry => entry.name === 'Rare boots')?.chaos).toBeUndefined();
    expect(report.warnings.join(' ')).toContain('Unknown items are excluded');
  });

  it('prices active equipment-slot gems only and reports inactive or unknown slots', async () => {
    const gem = { name: 'Vortex', level: 20, quality: 0, enabled: true };
    const market = { get: async () => ({ fetchedAt: '2026-01-01', lines: [{ name: 'Vortex', gemLevel: 20, chaosValue: 10 }] }) };
    const report = await estimateBuildCost(market, 'Standard', [], [
      { index: 1, label: 'active weapon', slotEnabled: true, gems: [gem] },
      { index: 2, label: 'swap weapon', slotEnabled: false, gems: [gem] },
      { index: 3, label: 'unknown slot', gems: [gem] },
    ]);
    expect(report.estimatedSubtotal).toBe(10);
    expect(report.entries.map(entry => entry.status)).toEqual(['reference', 'unknown', 'unknown']);
    expect(report.entries[1].note).toContain('inactive equipment slot');
    expect(report.entries[2].note).toContain('state is unknown');
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
