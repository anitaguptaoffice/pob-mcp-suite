import { describe, expect, it, jest } from '@jest/globals';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import { handleSetGemEnabled, handleSetSocketGroupEnabled, handleToggleFlask } from '../../src/handlers/itemSkillHandlers.js';

describe('toggle input validation', () => {
  it('rejects non-boolean values and fractional indices before calling PoB', async () => {
    const setFlaskActive = jest.fn(), setSocketGroupEnabled = jest.fn(), setGemEnabled = jest.fn();
    const client = { setFlaskActive, setSocketGroupEnabled, setGemEnabled } as unknown as PoBLuaApiClient;
    const context = { getLuaClient: () => client, ensureLuaClient: async () => {} };
    const fakeFalse = 'false' as unknown as boolean;
    await expect(handleToggleFlask(context, 1, fakeFalse)).rejects.toThrow('boolean');
    await expect(handleToggleFlask(context, 1.5, true)).rejects.toThrow('integer');
    await expect(handleSetSocketGroupEnabled(context, 1, fakeFalse)).rejects.toThrow('boolean');
    await expect(handleSetGemEnabled(context, 1, 1, fakeFalse)).rejects.toThrow('boolean');
    await expect(handleSetGemEnabled(context, 1, 1.5, true)).rejects.toThrow('integer');
    expect(setFlaskActive).not.toHaveBeenCalled();
    expect(setSocketGroupEnabled).not.toHaveBeenCalled();
    expect(setGemEnabled).not.toHaveBeenCalled();
  });
});
