import { describe, expect, it, jest } from '@jest/globals';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import { handleAddMultipleItems } from '../../src/handlers/itemSkillHandlers.js';

describe('batch item addition', () => {
  it('validates all input before mutating the build', async () => {
    const addItem = jest.fn();
    const context = { getLuaClient: () => ({ addItem } as unknown as PoBLuaApiClient), ensureLuaClient: async () => {} };
    await expect(handleAddMultipleItems(context, [{ item_text: 'valid' }, { item_text: '  ' }])).rejects.toThrow('no items were added');
    expect(addItem).not.toHaveBeenCalled();
  });

  it('stops at the first engine error and reports completed and unattempted items', async () => {
    const addItem = jest.fn<PoBLuaApiClient['addItem']>()
      .mockResolvedValueOnce({ id: 42, name: 'First', slot: 'Ring 1' })
      .mockRejectedValueOnce(new Error('invalid slot'));
    const context = { getLuaClient: () => ({ addItem } as unknown as PoBLuaApiClient), ensureLuaClient: async () => {} };
    const result = await handleAddMultipleItems(context, [
      { item_text: 'first' }, { item_text: 'second' }, { item_text: 'third' },
    ]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id=42 First -> Ring 1');
    expect(result.content[0].text).toContain('Batch stopped at item 2 of 3');
    expect(result.content[0].text).toContain('Items not attempted: 1');
    expect(result.content[0].text).toContain('may have changed the build');
    expect(addItem).toHaveBeenCalledTimes(2);
  });
});
