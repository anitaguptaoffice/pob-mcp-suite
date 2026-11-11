import { createStatCategoriesTool } from '../../src/features/statCategories/tool.js';
import { LEGACY_DEFENSE_FIELDS, LEGACY_OFFENSE_FIELDS, statCategoryFields } from '../../src/domain/statCategories.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import { handleLuaGetStats, type LuaHandlerContext } from '../../src/handlers/luaHandlers.js';

it('shares legacy category fields, adds full damage, and preserves unknowns and zeroes', async () => {
  const evaluate = jest.fn(async (snapshotId: string, fields: string[]) => ({ snapshotId, fields, warnings: [], stats: { Life: 0 }, metrics: { Life: { status: 'available', value: 0 }, MinionCombinedDPS: { status: 'unknown', value: null } }, context: { config: { enemyIsBoss: true } } }));
  const tool = createStatCategoriesTool({ evaluate } as unknown as BuildFoundation);
  const id = 'a'.repeat(64);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id, category: 'all' })).content[0].text);
  for (const field of [...LEGACY_OFFENSE_FIELDS, ...LEGACY_DEFENSE_FIELDS, 'FullDPS']) expect(result.fields).toContain(field);
  expect(result.fields.length).toBe(new Set(result.fields).size); expect(result.fields.length).toBeLessThanOrEqual(100);
  expect(result.metrics.Life).toEqual({ status: 'available', value: 0 }); expect(result.metrics.MinionCombinedDPS).toEqual({ status: 'unknown', value: null });
  expect(result.context.config.enemyIsBoss).toBe(true); expect(evaluate).toHaveBeenCalledTimes(1);
  const mutable = statCategoryFields('defense'); mutable.pop(); expect(statCategoryFields('defense')).toHaveLength(LEGACY_DEFENSE_FIELDS.length);
});

it('validates input and forwards temporary calculation context', async () => {
  const evaluate = jest.fn(async () => ({ warnings: [], metrics: {}, stats: {}, context: {} }));
  const tool = createStatCategoriesTool({ evaluate } as unknown as BuildFoundation), id = 'b'.repeat(64);
  await expect(tool.invoke({ snapshot_id: id, category: 'invalid' })).rejects.toThrow('stat category');
  await tool.invoke({ snapshot_id: id, category: 'offense', selection: { mainSocketGroup: 2 }, config: { conditionShocked: true } });
  expect(evaluate).toHaveBeenCalledWith(id, statCategoryFields('offense'), { selection: { mainSocketGroup: 2 }, config: { conditionShocked: true } });
});

it('keeps the legacy offense and defense requests unchanged', async () => {
  const getStats = jest.fn(async () => ({}));
  const context = { ensureLuaClient: async () => {}, getLuaClient: () => ({ getStats }) } as unknown as LuaHandlerContext;
  await handleLuaGetStats(context, 'offense'); await handleLuaGetStats(context, 'defense'); await handleLuaGetStats(context, 'all');
  expect(getStats).toHaveBeenNthCalledWith(1, [...LEGACY_OFFENSE_FIELDS]);
  expect(getStats).toHaveBeenNthCalledWith(2, [...LEGACY_DEFENSE_FIELDS]);
  expect(getStats).toHaveBeenNthCalledWith(3, undefined);
});
