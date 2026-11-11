import { describe, expect, it, jest } from '@jest/globals';
import type { PoBLuaApiClient } from '../../src/adapters/pob/bridge.js';
import { handleSetupSkillWithGems } from '../../src/handlers/itemSkillHandlers.js';

describe('skill group setup', () => {
  it('checks every input before creating a group', async () => {
    const createSocketGroup = jest.fn();
    const client = { createSocketGroup } as unknown as PoBLuaApiClient;
    await expect(handleSetupSkillWithGems({ getLuaClient: () => client, ensureLuaClient: async () => {} },
      [{ name: 'Arc' }, { name: '' }])).rejects.toThrow('no socket group was created');
    expect(createSocketGroup).not.toHaveBeenCalled();
    await expect(handleSetupSkillWithGems({ getLuaClient: () => client, ensureLuaClient: async () => {} },
      [{ name: 'Arc', quality_id: 'Anomalous' }])).rejects.toThrow('no socket group was created');
    expect(createSocketGroup).not.toHaveBeenCalled();
  });

  it('reports the created group and partial additions when a gem fails', async () => {
    const createSocketGroup = jest.fn<PoBLuaApiClient['createSocketGroup']>().mockResolvedValue({ index: 3 });
    const addGem = jest.fn<PoBLuaApiClient['addGem']>()
      .mockResolvedValueOnce({ gemIndex: 1, name: 'Arc' })
      .mockRejectedValueOnce(new Error('unrecognized gem'));
    const client = { createSocketGroup, addGem } as unknown as PoBLuaApiClient;
    const result = await handleSetupSkillWithGems({ getLuaClient: () => client, ensureLuaClient: async () => {} },
      [{ name: 'Arc' }, { name: 'Bad' }, { name: 'Later' }]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Socket group 3 was created');
    expect(result.content[0].text).toContain('Arc (L20, Q0)');
    expect(result.content[0].text).toContain('Gems not attempted: 1');
    expect(addGem).toHaveBeenCalledTimes(2);
  });
});
