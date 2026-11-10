import { describe, expect, it, jest } from '@jest/globals';
import { inspectItemAffixWeight } from '../../src/features/affixWeight/tool.js';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';

describe('item affix weight inspection', () => {
  it('exposes the engine weight separately from item-level eligibility and probability', async () => {
    const getItemAffixWeight = jest.fn<PoBLuaApiClient['getItemAffixWeight']>().mockResolvedValue({
      modId: 'Test', base: 'Amulet', weight: 1000, itemLevel: 1, requiredItemLevel: 52,
    });
    const result = await inspectItemAffixWeight({ getItemAffixWeight }, { mod_id: 'Test', item_text: 'item' });
    expect(result).toMatchObject({ weight: 1000, itemLevelAllows: false, source: 'current_pob_item_data' });
    expect(result.warnings.join(' ')).toContain('not a probability');
    expect(getItemAffixWeight).toHaveBeenCalledWith('Test', 'item');
  });

  it('preserves unknown eligibility and rejects invalid input before calling the engine', async () => {
    const getItemAffixWeight = jest.fn<PoBLuaApiClient['getItemAffixWeight']>().mockResolvedValue({
      modId: 'Test', base: 'Amulet', weight: 0,
    });
    const client = { getItemAffixWeight };
    expect((await inspectItemAffixWeight(client, { mod_id: 'Test', item_text: 'item' })).itemLevelAllows).toBeNull();
    await expect(inspectItemAffixWeight(client, { mod_id: '', item_text: 'item' })).rejects.toThrow();
    expect(getItemAffixWeight).toHaveBeenCalledTimes(1);
  });
});
