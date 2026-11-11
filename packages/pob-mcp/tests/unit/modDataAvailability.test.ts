import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadExplicitMods, ModDataUnavailableError } from '../../src/adapters/modifierData/modDataStore.js';
import { MOD_EXPLICIT_EXCERPT } from '../fixtures/modDataExcerpt.js';

describe('PoB affix data', () => {
  let root: string;
  let previousPath: string | undefined;
  beforeEach(async () => {
    previousPath = process.env.POB_PATH;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pob-mod-data-'));
    await fs.mkdir(path.join(root, 'src', 'Data'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'HeadlessWrapper.lua'), '-- engine marker\n');
    process.env.POB_PATH = path.join(root, 'src');
  });
  afterEach(async () => {
    if (previousPath === undefined) delete process.env.POB_PATH;
    else process.env.POB_PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('loads explicit affixes from the engine checkout', async () => {
    await fs.writeFile(path.join(root, 'src', 'Data', 'ModExplicit.lua'), MOD_EXPLICIT_EXCERPT);
    const mods = loadExplicitMods();
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.some(mod => mod.id === 'ChaosResist6')).toBe(true);
  });

  it('reports a missing engine data file instead of reading another layout', async () => {
    await fs.writeFile(path.join(root, 'src', 'Data', 'ModItem.lua'), MOD_EXPLICIT_EXCERPT);
    expect(() => loadExplicitMods()).toThrow(ModDataUnavailableError);
    expect(() => loadExplicitMods()).toThrow(/ModExplicit\.lua/);
  });
});
