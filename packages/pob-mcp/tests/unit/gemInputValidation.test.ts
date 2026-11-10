import { describe, expect, it, jest } from '@jest/globals';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import { handleAddGem, handleSetGemLevel, handleSetGemQuality, handleSetupSkillWithGems } from '../../src/handlers/itemSkillHandlers.js';

describe('gem simulation inputs', () => {
  it('rejects fractional and out-of-range parameters before mutating the engine', async () => {
    const addGem = jest.fn(), setGemLevel = jest.fn(), setGemQuality = jest.fn();
    const client = { addGem, setGemLevel, setGemQuality } as unknown as PoBLuaApiClient;
    const ctx = { getLuaClient: () => client, ensureLuaClient: async () => {} };
    await expect(handleAddGem(ctx, 1, 'Arc', 0)).rejects.toThrow('level');
    await expect(handleAddGem(ctx, 1, 'Arc', 20, 100)).rejects.toThrow('quality');
    await expect(handleSetGemLevel(ctx, 1, 1, 1.5)).rejects.toThrow('level');
    await expect(handleSetGemQuality(ctx, 1, 1, 0.5)).rejects.toThrow('quality');
    expect(addGem).not.toHaveBeenCalled();
    expect(setGemLevel).not.toHaveBeenCalled();
    expect(setGemQuality).not.toHaveBeenCalled();
  });

  it('permits quality 30 consistently in add, edit and group setup', async () => {
    const addGem = jest.fn<PoBLuaApiClient['addGem']>().mockResolvedValue({ gemIndex: 1, name: 'Arc' });
    const setGemQuality = jest.fn<PoBLuaApiClient['setGemQuality']>().mockResolvedValue(undefined);
    const createSocketGroup = jest.fn<PoBLuaApiClient['createSocketGroup']>().mockResolvedValue({ index: 1 });
    const client = { addGem, setGemQuality, createSocketGroup } as unknown as PoBLuaApiClient;
    const ctx = { getLuaClient: () => client, ensureLuaClient: async () => {} };
    await handleAddGem(ctx, 1, 'Arc', 20, 30);
    await handleSetGemQuality(ctx, 1, 1, 30);
    await handleSetupSkillWithGems(ctx, [{ name: 'Arc', quality: 30 }]);
    expect(addGem).toHaveBeenCalledTimes(2);
    expect(setGemQuality).toHaveBeenCalledWith(expect.objectContaining({ quality: 30 }));
  });
});
