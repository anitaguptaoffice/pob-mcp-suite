import { compareJewelContexts } from '../../src/features/jewelComparison/context.js';

const normal = (index: number, name: string) => ({ index, slot: 'Helmet', enabled: true, gems: [{ index: 1, name }] });
const generated = (index: number) => ({ index, enabled: true, gems: [{ index: 1, name: '' }], skills: ['On Kill Monster Explosion'] });
const context = (groups: object[], mainSocketGroup: number, calcsSkillNumber: number) => ({ build: { level: 90 }, config: { enemyLevel: 84 }, skills: { groups, mainSocketGroup, calcsSkillNumber } });

it('allows unique generated-group reindexing while preserving selected groups', () => {
  const before = context([normal(1, 'Fireball'), generated(2), normal(3, 'Grace')], 1, 3);
  const after = context([normal(1, 'Fireball'), normal(2, 'Grace'), generated(3)], 1, 2);
  expect(compareJewelContexts(before, after)).toBe('generated_group_reindexed');
  expect(compareJewelContexts(before, before)).toBe('identical');
  expect(compareJewelContexts(before, { ...after, config: { enemyLevel: 70 } })).toBe('different');
  expect(compareJewelContexts(before, { ...after, skills: { ...after.skills, calcsSkillNumber: 3 } })).toBe('different');
  expect(compareJewelContexts(before, { ...after, skills: { ...after.skills, mainSocketGroup: 2 } })).toBe('different');
  expect(compareJewelContexts(before, { ...after, skills: { ...after.skills, calcsSkillNumber: undefined } })).toBe('different');
});

it('rejects reordering ordinary groups, ambiguous duplicates and changed generated groups', () => {
  const before = context([normal(1, 'Fireball'), generated(2), normal(3, 'Grace')], 1, 3);
  expect(compareJewelContexts(before, context([normal(1, 'Grace'), normal(2, 'Fireball'), generated(3)], 2, 1))).toBe('different');
  const duplicates = context([normal(1, 'Grace'), generated(2), normal(3, 'Grace')], 1, 3);
  expect(compareJewelContexts(duplicates, context([normal(1, 'Grace'), normal(2, 'Grace'), generated(3)], 1, 2))).toBe('different');
  expect(compareJewelContexts(before, context([normal(1, 'Fireball'), normal(2, 'Grace'), { ...generated(3), skills: ['Different'] }], 1, 2))).toBe('different');
});
