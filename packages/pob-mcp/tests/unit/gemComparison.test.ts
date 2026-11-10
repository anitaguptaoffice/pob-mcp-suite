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
  it('preserves existing gem parameters and does not fabricate missing DPS', async () => {
    const original = [
      { name: 'Active', isSupport: false, enabled: true, level: 21, quality: 20, qualityId: 'Default', count: 3, enableGlobal1: true, enableGlobal2: true },
      { name: 'Support', isSupport: true, enabled: true, level: 19, quality: 10, qualityId: 'Default', count: 1 },
    ];
    let gems = [...original];
    const addGem = jest.fn(async (p: { gemName: string; level?: number; quality?: number; count?: number; enableGlobal2?: boolean }) => {
      gems.push({ name: p.gemName, isSupport: p.gemName !== 'Active', enabled: true, level: p.level!, quality: p.quality!, qualityId: 'Default', count: p.count!, enableGlobal1: true, enableGlobal2: p.enableGlobal2 ?? false });
    });
    const close = jest.fn(async () => {});
    const client = {
      loadBuildXml: async () => { gems = [...original]; }, getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, mainActiveSkill: 1, gems }] }),
      removeGem: async ({ gemIndex }: { gemIndex: number }) => { gems.splice(gemIndex - 1, 1); }, addGem,
      getStats: async () => ({ TotalDPS: 0, MinionCombinedDPS: 123 }),
    } as unknown as PoBLuaApiClient;
    const result = await compareGemSetups({ pobDirectory: dir, createIsolatedLuaClient: async () => ({ client, close }) },
      { build_name: 'saved', setups: [{ name: 'one', gems: ['Active', 'Support'] }, { name: 'two', gems: ['Active'] }] });
    expect(addGem.mock.calls[0][0]).toMatchObject({ gemName: 'Active', count: 3, enableGlobal2: true, level: 21, quality: 20 });
    expect(result.setups[0].stats).toMatchObject({ TotalDPS: 0, CombinedDPS: null, MinionCombinedDPS: 123 });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
