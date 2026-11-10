import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import { compareGemSetups } from '../../src/features/gemComparison/compare.js';
import { rankSupportGems } from '../../src/features/supportRanking/rank.js';

jest.mock('../../src/features/gemComparison/compare.js', () => ({ compareGemSetups: jest.fn() }));
const compare = jest.mocked(compareGemSetups);

describe('support gem ranking', () => {
  let dir: string;
  const close = jest.fn(async () => {});
  const client = { loadBuildXml: async () => ({}), getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [
    { name: 'Summon Raging Spirit', enabled: true, isSupport: false }, { name: 'Old Support', enabled: true, isSupport: true },
  ] }] }) } as unknown as PoBLuaApiClient;
  const source = () => ({ pobDirectory: dir, createIsolatedLuaClient: async () => ({ client, close }) });
  const stats = (player: number | null, minion: number | null) => ({ CombinedDPS: player, TotalDPS: 0, MinionCombinedDPS: minion, MinionTotalDPS: 80 });
  const comparison = (base: ReturnType<typeof stats>) => ({ source: 'saved_build_isolated_pob', activeGem: 'Summon Raging Spirit', baseline: base,
    mainGroup: 1, warnings: [], setups: [
      { name: 'baseline', gems: [], stats: base },
      { name: 'Good', gems: [{ name: 'Good', appliedToSelectedSkill: true }], stats: { ...base, MinionCombinedDPS: 150 } },
      { name: 'Bad', gems: [{ name: 'Bad', appliedToSelectedSkill: false }], stats: { ...base, MinionCombinedDPS: 999 } },
      { name: 'Unknown', gems: [{ name: 'Unknown', appliedToSelectedSkill: null }], stats: { ...base, MinionCombinedDPS: 888 } },
    ] });
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pob-rank-')); await fs.writeFile(path.join(dir, 'saved.xml'), '<PathOfBuilding/>'); compare.mockReset(); close.mockClear(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  it('uses poison-inclusive minion damage and excludes unconfirmed supports', async () => {
    compare.mockResolvedValue(comparison(stats(0, 100)) as unknown as Awaited<ReturnType<typeof compareGemSetups>>);
    const result = await rankSupportGems(source(), { build_name: 'saved', replace_gem: 'Old Support', candidates: ['Good', 'Bad', 'Unknown'] });
    expect(result.metric).toBe('MinionCombinedDPS');
    expect(result.metricSelection).toBe('automatic');
    expect(result.warnings.join(' ')).toContain('selected automatically');
    expect(compare.mock.calls[0][2]).toEqual({ xml: '<PathOfBuilding/>', path: path.join(dir, 'saved.xml') });
    expect(result.ranked).toEqual([{ gem: 'Good', damage: 150, delta: 50, deltaPercent: 50 }]);
    expect(result.unranked.map(g => g.gem)).toEqual(['Bad', 'Unknown']);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('reports absolute change without an invented percentage when baseline is zero', async () => {
    compare.mockResolvedValue(comparison(stats(0, 0)) as unknown as Awaited<ReturnType<typeof compareGemSetups>>);
    const result = await rankSupportGems(source(), { build_name: 'saved', replace_gem: 'Old Support', candidates: ['Good'], damage_metric: 'MinionCombinedDPS' });
    expect(result.metricSelection).toBe('explicit');
    expect(result.ranked[0]).toEqual({ gem: 'Good', damage: 150, delta: 150, deltaPercent: null });
  });

  it('requires an explicit metric when both player and minion damage are present', async () => {
    compare.mockResolvedValue(comparison(stats(50, 100)) as unknown as Awaited<ReturnType<typeof compareGemSetups>>);
    await expect(rankSupportGems(source(), { build_name: 'saved', replace_gem: 'Old Support', candidates: ['Good'] })).rejects.toThrow('metric is ambiguous');
  });
  it('refuses a changed baseline rather than ranking an invalid comparison', async () => {
    const changed = comparison(stats(0, 100));
    changed.setups[0].stats = stats(0, 99);
    compare.mockResolvedValue(changed as unknown as Awaited<ReturnType<typeof compareGemSetups>>);
    await expect(rankSupportGems(source(), { build_name: 'saved', replace_gem: 'Old Support', candidates: ['Good'] })).rejects.toThrow('baseline changed');
  });
});
