import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import { compareGemSetups } from '../../src/features/gemComparison/compare.js';

describe('isolated gem comparison', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pob-gem-test-')); await fs.writeFile(path.join(dir, 'saved.xml'), '<PathOfBuilding/>'); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  it.each([
    { Ghost: { level: 20 } }, { Active: { quality: 24 } }, { Active: { level: 0 } },
    { Active: { level: 20 }, active: { quality: 20 } },
  ])('rejects invalid or ambiguous overrides before starting PoB: %j', async (gem_overrides) => {
    const factory = jest.fn();
    await expect(compareGemSetups({ pobDirectory: dir, createIsolatedLuaClient: factory as never }, { build_name: 'saved', setups: [
      { name: 'one', gems: ['Active'], gem_overrides: gem_overrides as unknown as Record<string, { level?: number; quality?: number }> }, { name: 'two', gems: ['Active'] },
    ] })).rejects.toThrow('invalid gem override');
    expect(factory).not.toHaveBeenCalled();
  });

  it('preserves existing gem parameters and does not fabricate missing DPS', async () => {
    const original = [
      { index: 1, name: 'Active', isSupport: false, enabled: true, level: 21, quality: 20, qualityId: 'Default', count: 3, enableGlobal1: true, enableGlobal2: true },
      { index: 2, name: 'Support', isSupport: true, enabled: true, level: 19, quality: 10, qualityId: 'Default', count: 1 },
    ];
    let gems = [...original];
    const addGem = jest.fn(async (p: { gemName: string; level?: number; quality?: number; count?: number; enableGlobal2?: boolean; insertIndex?: number }) => {
      gems.splice((p.insertIndex ?? (gems.length + 1)) - 1, 0, { index: 0, name: p.gemName, isSupport: p.gemName !== 'Active', enabled: true, level: p.level!, quality: p.quality!, qualityId: 'Default', count: p.count!, enableGlobal1: true, enableGlobal2: p.enableGlobal2 ?? false });
      gems.forEach((gem, index) => { gem.index = index + 1; });
    });
    const close = jest.fn(async () => {});
    const client = {
      loadBuildXml: async () => { gems = [...original]; }, getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, mainActiveSkill: 1, gems }] }),
      removeGem: async ({ gemIndex }: { gemIndex: number }) => { gems.splice(gemIndex - 1, 1); gems.forEach((gem, index) => { gem.index = index + 1; }); }, addGem,
      setGemLevel: async ({ gemIndex, level }: { gemIndex: number; level: number }) => { gems[gemIndex - 1].level = level; },
      setGemQuality: async ({ gemIndex, quality }: { gemIndex: number; quality: number }) => { gems[gemIndex - 1].quality = quality; },
      getStats: async () => ({ TotalDPS: 0, MinionCombinedDPS: 123 }),
    } as unknown as PoBLuaApiClient;
    const result = await compareGemSetups({ pobDirectory: dir, createIsolatedLuaClient: async () => ({ client, close }) },
      { build_name: 'saved', setups: [{ name: 'one', gems: ['Active', 'Support'] }, { name: 'two', gems: ['Active', 'New Support'], gem_overrides: { Active: { level: 20 }, 'New Support': { quality: 23 } } }] });
    expect(addGem).toHaveBeenCalledTimes(1);
    expect(addGem.mock.calls[0][0]).toMatchObject({ gemName: 'New Support', level: 20, quality: 0, insertIndex: 2 });
    expect(result.setups[0].gems[0]).toMatchObject({ name: 'Active', count: 3, level: 21, quality: 20 });
    expect(result.setups[1].gems).toMatchObject([{ name: 'Active', level: 20 }, { name: 'New Support', quality: 23 }]);
    expect(result.setups[0].stats).toMatchObject({ TotalDPS: 0, CombinedDPS: null, MinionCombinedDPS: 123 });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
