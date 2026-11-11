import { createStatCategoriesTool } from '../../src/features/statCategories/tool.js';
import { DEFENSE_FIELDS, OFFENSE_FIELDS, statCategoryFields } from '../../src/domain/statCategories.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

it('shares the category fields, adds full damage, and preserves unknowns and zeroes', async () => {
  const evaluate = jest.fn(async (snapshotId: string, fields: string[]) => ({ snapshotId, fields, warnings: [], stats: { Life: 0 }, metrics: { Life: { status: 'available', value: 0 }, MinionCombinedDPS: { status: 'unknown', value: null } }, context: { config: { enemyIsBoss: true } } }));
  const tool = createStatCategoriesTool({ evaluate } as unknown as BuildFoundation);
  const id = 'a'.repeat(64);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id, category: 'all' })).content[0].text);
  for (const field of [...OFFENSE_FIELDS, ...DEFENSE_FIELDS, 'FullDPS']) expect(result.fields).toContain(field);
  expect(result.fields.length).toBe(new Set(result.fields).size); expect(result.fields.length).toBeLessThanOrEqual(100);
  expect(result.metrics.Life).toEqual({ status: 'available', value: 0 }); expect(result.metrics.MinionCombinedDPS).toEqual({ status: 'unknown', value: null });
  expect(result.context.config.enemyIsBoss).toBe(true); expect(evaluate).toHaveBeenCalledTimes(1);
  const mutable = statCategoryFields('defense'); mutable.pop(); expect(statCategoryFields('defense')).toHaveLength(DEFENSE_FIELDS.length);
});

it('validates input and forwards temporary calculation context', async () => {
  const evaluate = jest.fn(async () => ({ warnings: [], metrics: {}, stats: {}, context: {} }));
  const tool = createStatCategoriesTool({ evaluate } as unknown as BuildFoundation), id = 'b'.repeat(64);
  await expect(tool.invoke({ snapshot_id: id, category: 'invalid' })).rejects.toThrow('stat category');
  await tool.invoke({ snapshot_id: id, category: 'offense', selection: { mainSocketGroup: 2 }, config: { conditionShocked: true } });
  expect(evaluate).toHaveBeenCalledWith(id, statCategoryFields('offense'), { selection: { mainSocketGroup: 2 }, config: { conditionShocked: true } });
});

it('keeps the offense and defense field requests unchanged', async () => {
  for (const [category, fields] of [['offense', OFFENSE_FIELDS], ['defense', DEFENSE_FIELDS]] as const) {
    const evaluate = jest.fn(async () => ({ warnings: [], metrics: {}, stats: {}, context: {} }));
    const tool = createStatCategoriesTool({ evaluate } as unknown as BuildFoundation);
    await tool.invoke({ snapshot_id: 'c'.repeat(64), category });
    expect(evaluate).toHaveBeenCalledWith('c'.repeat(64), expect.arrayContaining([...fields]), expect.anything());
  }
});
