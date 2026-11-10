import { createSnapshotCostTool } from '../../src/features/buildCost/snapshotTool.js';
import { estimateBuildCost } from '../../src/features/buildCost/estimate.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { EconomyQuery, EconomySource } from '../../src/ports/economySource.js';
import { PoeNinjaAdapter } from '../../src/adapters/poeNinja/poeNinjaAdapter.js';
import { NinjaPrices } from '../../src/features/buildCost/ninjaPrices.js';

const id = 'a'.repeat(64);
const fetchedAt = '2026-01-01T00:00:00.000Z';
const item = { slot: 'Helmet', id: 1, name: 'Example', baseName: 'Circlet', rarity: 'UNIQUE', raw: 'Rarity: UNIQUE\nExample\nCirclet' };
const rare = { slot: 'Boots', id: 2, name: 'Rare', rarity: 'RARE' };
const groups = [{ index: 1, slotEnabled: true, gems: [{ name: 'Vortex', level: 20, quality: 0, enabled: true }] }];
const lines = (category: string) => category === 'UniqueArmour' ? [{ name: 'Example', baseType: 'Circlet', chaosValue: 12, listingCount: 15 }]
  : category === 'SkillGem' ? [{ name: 'Vortex', gemLevel: 20, gemQuality: 0, chaosValue: 5 }] : [];
const foundation = { inspect: async () => ({ data: { items: [item, rare], skills: { groups } }, identity: { engineVersion: 'test' }, warnings: [] }) } as unknown as Pick<BuildFoundation, 'inspect'>;

describe('snapshot build cost feature', () => {
  it('matches the existing price policy while retaining snapshot and source provenance', async () => {
    const source: EconomySource = { read: async query => ({ source: 'poe.ninja', query, fetchedAt, payload: { lines: lines(query.kind === 'items' ? query.category : '') } }) };
    const result = JSON.parse((await createSnapshotCostTool(foundation, source).invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    const legacy = await estimateBuildCost({ get: async (_league, category) => ({ fetchedAt, lines: lines(category) }) }, 'Standard', [item, rare], groups);
    expect(result).toMatchObject({ ...JSON.parse(JSON.stringify(legacy)), snapshotId: id, identity: { engineVersion: 'test' }, failures: [] });
    expect(result.estimatedSubtotal).toBe(17);
    expect(result.complete).toBe(false);
    expect(result.entries.find((entry: { name: string }) => entry.name === 'Rare').status).toBe('unknown');
    expect(result.sources).toHaveLength(6);
    expect(result.sources.every((source: { fetchedAt: string; league: string }) => source.fetchedAt === fetchedAt && source.league === 'Standard')).toBe(true);
  });

  it('matches the legacy provider against the same source response', async () => {
    const fetcher = (async (url: string) => new Response(JSON.stringify({ lines: lines(new URL(url).searchParams.get('type') ?? '') }), { status: 200 })) as unknown as typeof fetch;
    const current = createSnapshotCostTool(foundation, new PoeNinjaAdapter(fetcher, () => 0));
    const actual = JSON.parse((await current.invoke({ snapshot_id: id, league: 'Standard' })).content[0].text);
    const previous = await estimateBuildCost(new NinjaPrices(fetcher, () => 0), 'Standard', [item, rare], groups);
    expect(actual).toMatchObject(JSON.parse(JSON.stringify(previous)));
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
});
