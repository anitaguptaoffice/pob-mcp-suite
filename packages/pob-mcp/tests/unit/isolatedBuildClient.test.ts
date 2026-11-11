import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoBLuaApiClient } from '../../src/adapters/pob/bridge.js';
import { withBuildClient } from '../../src/utils/isolatedBuildClient.js';

describe('isolated named build engine', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pob-opt-isolated-'));
    await fs.writeFile(path.join(dir, 'target.xml'), '<PathOfBuilding/>');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('uses and closes a separate engine without replacing the current build', async () => {
    const currentLoad = jest.fn();
    const targetLoad = jest.fn(async () => ({}));
    const close = jest.fn(async () => undefined);
    const current = { getBuildInfo: async () => ({ name: 'unsaved' }), loadBuildXml: currentLoad } as unknown as PoBLuaApiClient;
    const target = { loadBuildXml: targetLoad } as unknown as PoBLuaApiClient;
    const context = { pobDirectory: dir, ensureLuaClient: async () => {}, getLuaClient: () => current,
      createIsolatedLuaClient: async () => ({ client: target, close }) };
    const result = await withBuildClient(context, 'target', async (client, isolated) => {
      expect(client).toBe(target);
      expect(isolated).toBe(true);
      return 'done';
    });
    expect(result).toBe('done');
    expect(currentLoad).not.toHaveBeenCalled();
    expect(targetLoad).toHaveBeenCalledWith('<PathOfBuilding/>', 'target', path.join(dir, 'target.xml'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the temporary engine when analysis fails', async () => {
    const close = jest.fn(async () => undefined);
    const current = { getBuildInfo: async () => ({ name: 'unsaved' }) } as unknown as PoBLuaApiClient;
    const target = { loadBuildXml: async () => ({}) } as unknown as PoBLuaApiClient;
    const context = { pobDirectory: dir, ensureLuaClient: async () => {}, getLuaClient: () => current,
      createIsolatedLuaClient: async () => ({ client: target, close }) };
    await expect(withBuildClient(context, 'target', async () => { throw new Error('analysis failed'); })).rejects.toThrow('analysis failed');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
