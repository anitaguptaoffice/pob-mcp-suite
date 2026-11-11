import { isDeepStrictEqual } from 'node:util';
import { normalizeObservation } from '../../foundation/observation.js';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/** Compare all observed state; permit only uniquely identifiable generated-group reindexing. */
export function compareJewelContexts(left: unknown, right: unknown): 'identical' | 'generated_group_reindexed' | 'different' {
  const a = normalizeObservation(left), b = normalizeObservation(right);
  if (isDeepStrictEqual(a, b)) return 'identical';
  if (!record(a) || !record(b) || !record(a.skills) || !record(b.skills)) return 'different';
  const { skills: as, ...restA } = a, { skills: bs, ...restB } = b;
  if (!isDeepStrictEqual(restA, restB)) return 'different';
  const leftSkills = as as Row, rightSkills = bs as Row;
  const { groups: ag, mainSocketGroup: am, calcsSkillNumber: ac, ...aOther } = leftSkills;
  const { groups: bg, mainSocketGroup: bm, calcsSkillNumber: bc, ...bOther } = rightSkills;
  if (!isDeepStrictEqual(aOther, bOther) || !Array.isArray(ag) || !Array.isArray(bg) || ag.length !== bg.length || !ag.length) return 'different';
  const validGroups = (groups: unknown[]) => groups.every((group, i) => record(group) && group.index === i + 1 && Array.isArray(group.gems));
  if (!validGroups(ag) || !validGroups(bg)) return 'different';
  const body = (group: Row) => { const { index: _index, ...value } = group; return value; };
  const generated = (group: Row) => group.slot === undefined && Array.isArray(group.gems) && group.gems.length === 1 && record(group.gems[0]) && group.gems[0].name === '';
  const map: number[] = [];
  for (const group of ag as Row[]) {
    const matches = (bg as Row[]).flatMap((candidate, i) => isDeepStrictEqual(body(group), body(candidate)) ? [i + 1] : []);
    if (matches.length !== 1 || map.includes(matches[0])) return 'different';
    map.push(matches[0]);
  }
  const selectionMatches = (before: unknown, after: unknown) => Number.isSafeInteger(before) && (before as number) >= 1 && (before as number) <= map.length && after === map[(before as number) - 1];
  if (!selectionMatches(am, bm) || !selectionMatches(ac, bc)) return 'different';
  // Ordinary groups keep their relative order; only an observed generated group
  // can cross them. Duplicate or otherwise changed groups were rejected above.
  const regular = (ag as Row[]).flatMap((group, i) => generated(group) ? [] : [map[i]]);
  if (!regular.every((value, i) => i === 0 || regular[i - 1] < value)) return 'different';
  return 'generated_group_reindexed';
}
