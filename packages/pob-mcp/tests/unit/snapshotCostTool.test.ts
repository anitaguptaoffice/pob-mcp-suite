import { createSnapshotCostTool } from '../../src/features/buildCost/snapshotTool.js';
import { estimateBuildCost } from '../../src/features/buildCost/estimate.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { EconomyQuery, EconomySource } from '../../src/ports/economySource.js';
import { PoeNinjaAdapter } from '../../src/adapters/poeNinja/poeNinjaAdapter.js';
import { NinjaPrices } from '../../src/features/buildCost/ninjaPrices.js';

const id = 'a'.repeat(64);
const fetchedAt = '2026-01-01T00:00:00.000Z';
const item = { slot: 'Helmet', id: 1, shown: true, name: 'Example', baseName: 'Circlet', rarity: 'UNIQUE', raw: 'Rarity: UNIQUE\nExample\nCirclet' };
const rare = { slot: 'Boots', id: 2, shown: true, name: 'Rare', rarity: 'RARE' };
const groups = [{ index: 1, slotEnabled: true, gems: [{ name: 'Vortex', level: 20, quality: 0, enabled: true }] }];
const sets = { activeItemSetId: 1, itemSets: [{ id: 1, title: 'Default', active: true, useSecondWeaponSet: false }] };
const lines = (category: string) => category === 'UniqueArmour' ? [{ name: 'Example', baseType: 'Circlet', chaosValue: 12, listingCount: 15 }]
  : category === 'SkillGem' ? [{ name: 'Vortex', gemLevel: 20, gemQuality: 0, chaosValue: 5 }] : [];
const foundation = { runReadOnlySnapshot: async (snapshotId: string, fn: (engine: unknown) => Promise<unknown>) => ({ snapshotId, result: await fn({ listItemSets: async () => sets, getItems: async () => [item, rare], getSkills: async () => ({ groups }) }), identity: { engineVersion: 'test' }, warnings: [] }) } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>;

describe('snapshot build cost feature', () => {
  it('matches the existing price policy while retaining snapshot and source provenance', async () => {
    const source: EconomySource = { read: async query => ({ source: 'poe.ninja', query, fetchedAt, payload: { lines: lines(query.kind === 'items' ? query.category : '') } }) };
    const result = JSON.parse((await createSnapshotCostTool(foundation, source).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    const direct = await estimateBuildCost({ get: async (_league, category) => ({ fetchedAt, lines: lines(category) }) }, 'Standard', [item, rare], groups);
    expect(result).toMatchObject({ ...JSON.parse(JSON.stringify(direct)), snapshotId: id, identity: { engineVersion: 'test' }, failures: [] });
    expect(result.estimatedSubtotal).toBe(17);
    expect(result.complete).toBe(false);
    expect(result.entries.find((entry: { name: string }) => entry.name === 'Rare').status).toBe('unknown');
    expect(result.sources).toHaveLength(6);
    expect(result.sources.every((source: { fetchedAt: string; league: string }) => source.fetchedAt === fetchedAt && source.league === 'Standard')).toBe(true);
  });

  it('matches the direct adapter path against the same source response', async () => {
    const fetcher = (async (url: string) => new Response(JSON.stringify({ lines: lines(new URL(url).searchParams.get('type') ?? '') }), { status: 200 })) as unknown as typeof fetch;
    const current = createSnapshotCostTool(foundation, new PoeNinjaAdapter(fetcher, () => 0));
    const actual = JSON.parse((await current.invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    const direct = await estimateBuildCost(new NinjaPrices(fetcher, () => 0), 'Standard', [item, rare], groups);
    expect(actual).toMatchObject(JSON.parse(JSON.stringify(direct)));
  });

  it('keeps failed categories unknown and preserves their typed failure', async () => {
    const source: EconomySource = { read: async (query: EconomyQuery) => {
      if (query.kind === 'items' && query.category === 'UniqueWeapon') throw Object.assign(new Error('unavailable'), { code: 'http', httpStatus: 503 });
      return { source: 'poe.ninja', query, fetchedAt, payload: { lines: lines(query.kind === 'items' ? query.category : '') } };
    } };
    const result = JSON.parse((await createSnapshotCostTool(foundation, source).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    expect(result.entries.find((entry: { name: string }) => entry.name === 'Example').status).toBe('unknown');
    expect(result.estimatedSubtotal).toBe(5);
    expect(result.failures).toEqual([{ category: 'UniqueWeapon', message: 'unavailable', code: 'http', httpStatus: 503 }]);
  });

  it('rejects unconfirmed provenance and malformed price lines as unavailable', async () => {
    const source: EconomySource = { read: async query => ({ source: 'poe.ninja', query, fetchedAt, payload: { lines: [null] } }) };
    const result = JSON.parse((await createSnapshotCostTool(foundation, source).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    expect(result.estimatedSubtotal).toBe(0);
    expect(result.pricedCount).toBe(0);
    expect(result.failures).toHaveLength(6);
    const mismatched: EconomySource = { read: async query => ({ source: 'poe.ninja', query: { ...query, league: 'Other' }, fetchedAt, payload: { lines: [] } }) };
    const wrong = JSON.parse((await createSnapshotCostTool(foundation, mismatched).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    expect(wrong.failures).toHaveLength(6);
    expect(wrong.failures[0].message).toContain('mismatched provenance');
    await expect(createSnapshotCostTool(foundation, source).invoke({ snapshot_id: id, league: '' })).rejects.toThrow('league');
  });
  it('excludes inactive weapons and marks unknown visibility instead of adding uncertain prices', async () => {
    const activeSets = { activeItemSetId: 1, itemSets: [{ ...sets.itemSets[0], useSecondWeaponSet: true }] };
    const rows = [
      { ...item, slot: 'Weapon 1', id: 10, shown: true },
      { ...item, slot: 'Weapon 1 Swap', id: 11, shown: true },
      { ...item, slot: 'Helmet', id: 12, shown: undefined },
      { ...item, slot: 'Weapon 1 Abyssal Socket 1', id: 13, shown: true },
      { ...item, slot: 'Weapon 1Swap Abyssal Socket 1', id: 14, shown: true },
    ];
    const testFoundation = { runReadOnlySnapshot: async (snapshotId: string, fn: (engine: unknown) => Promise<unknown>) => ({ snapshotId, result: await fn({ listItemSets: async () => activeSets, getItems: async () => rows, getSkills: async () => ({ groups: [] }) }), identity: {}, warnings: [] }) } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>;
    const source: EconomySource = { read: async query => ({ source: 'poe.ninja', query, fetchedAt, payload: { lines: lines(query.kind === 'items' ? query.category : '') } }) };
    const result = JSON.parse((await createSnapshotCostTool(testFoundation, source).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    expect(result.estimatedSubtotal).toBe(24);
    expect(result.activeItemSet.useSecondWeaponSet).toBe(true);
    expect(result.excludedItems).toEqual([{ slot: 'Weapon 1', itemId: 10, reason: 'inactive_or_hidden' }, { slot: 'Weapon 1 Abyssal Socket 1', itemId: 13, reason: 'inactive_or_hidden' }]);
    expect(result.entries).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'Weapon 1 Swap', status: 'reference' }), expect.objectContaining({ slot: 'Helmet', status: 'unknown', note: expect.stringContaining('visibility is unknown') })]));
    expect(result.unknownCount).toBe(1);
    expect(result.entries.some((entry: { slot: string }) => entry.slot === 'Weapon 1')).toBe(false);
    expect(result.entries.some((entry: { slot: string }) => entry.slot === 'Weapon 1Swap Abyssal Socket 1')).toBe(true);
  });
});
