import { EngineLimiter } from '../../src/foundation/engineLimiter.js';
import { PoBItemDataAdapter } from '../../src/adapters/pobItemData/source.js';
import { createItemAffixWeightTool } from '../../src/features/affixWeight/sourceTool.js';
import type { BuildEngine } from '../../src/foundation/buildFoundation.js';
import type { PoBItemDataSource } from '../../src/ports/pobItemDataSource.js';

it('leases a disposable engine, checks identity, and closes it for data-only queries', async () => {
  const newBuild = jest.fn().mockResolvedValue({}), getItemAffixWeight = jest.fn().mockResolvedValue({ modId: 'A', base: 'Ring', weight: 0 }), verifyIdentity = jest.fn(), close = jest.fn();
  const engine = { newBuild, getItemAffixWeight, verifyIdentity, close, identity: { engineVersion: 'v', dataVersion: 'd', adapterVersion: 'a' } } as unknown as BuildEngine;
  const source = new PoBItemDataAdapter(new EngineLimiter(async () => engine));
  const result = await source.weight('A', 'item');
  expect(newBuild).toHaveBeenCalledTimes(1); expect(verifyIdentity).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  expect(result.identity.dataVersion).toBe('d');
});
it('reports zero, level eligibility and unknowns without implying probability', async () => {
  const weight = jest.fn().mockResolvedValue({ result: { modId: 'A', base: 'Ring', weight: 0, itemLevel: 1, requiredItemLevel: 52 }, identity: {} });
  const tool = createItemAffixWeightTool({ weight } as unknown as PoBItemDataSource);
  const value = JSON.parse((await tool.invoke({ mod_id: 'A', item_text: 'item' })).content[0].text);
  expect(value.weight).toBe(0); expect(value.itemLevelAllows).toBe(false); expect(value.warnings.join(' ')).toContain('not a crafting probability');
  weight.mockResolvedValueOnce({ result: { modId: 'A', base: 'Ring', weight: 1000 }, identity: {} });
  expect(JSON.parse((await tool.invoke({ mod_id: 'A', item_text: 'item' })).content[0].text).itemLevelAllows).toBeNull();
  await expect(tool.invoke({ mod_id: '', item_text: 'item' })).rejects.toThrow('Valid modifier'); expect(weight).toHaveBeenCalledTimes(2);
});
it('closes the engine if data verification fails', async () => {
  const close = jest.fn(), engine = { newBuild: jest.fn(), getItemAffixWeight: jest.fn(), verifyIdentity: jest.fn().mockRejectedValue(new Error('changed')), close } as unknown as BuildEngine;
  await expect(new PoBItemDataAdapter(new EngineLimiter(async () => engine)).weight('A', 'item')).rejects.toThrow('changed');
  expect(close).toHaveBeenCalledTimes(1);
});
