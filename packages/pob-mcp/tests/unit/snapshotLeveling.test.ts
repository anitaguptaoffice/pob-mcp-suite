import { createLevelingTool } from '../../src/features/leveling/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64);
function toolWith(data: Record<string, unknown>) {
  const inspect = jest.fn(async () => ({ snapshotId: id, identity: {}, warnings: [], data }));
  return { tool: createLevelingTool({ inspect } as unknown as BuildFoundation), inspect };
}

it('uses PoB selected active skill instead of the first gem, with labeled reference examples', async () => {
  const { tool, inspect } = toolWith({ build: { className: 'Witch', ascendClassName: 'Necromancer', level: 80 }, tree: { className: 'Witch', ascendClassName: 'Necromancer', treeVersion: '3_29' }, skills: { mainSocketGroup: 2, groups: [
    { index: 1, gems: [], skills: ['Wrong Skill'] },
    { index: 2, enabled: true, slotEnabled: true, mainActiveSkill: 2, skills: ['First Skill', 'Selected Skill'], gems: [{ index: 1, name: 'Support', isSupport: true, supportClassificationKnown: true, enabled: true, appliedToSelectedSkill: false, level: 20 }, { index: 2, name: 'Gem', isSupport: false, supportClassificationKnown: true, enabled: true, level: 20 }] },
  ] } });
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(inspect).toHaveBeenCalledWith(id, ['build', 'tree', 'skills']);
  expect(result.selectedSkill.name).toBe('Selected Skill'); expect(result.selectedSkill.groupIndex).toBe(2);
  expect(result.selectedSkill.gems[0].kind).toBe('support'); expect(result.selectedSkill.gems[0].appliedToSelectedSkill).toBe(false);
  expect(result.build.ascendancy).toBe('Necromancer'); expect(result.referenceExamples.status).toBe('unverified');
  expect(result.referenceExamples.starter.early).toBe('Freezing Pulse or Arc');
});

it('does not invent a class, selection, or starter when context is missing or inconsistent', async () => {
  const { tool } = toolWith({ build: { className: 'Witch' }, tree: { className: 'Marauder' }, skills: { mainSocketGroup: 4, groups: [{ index: 1, skills: ['Unselected'], gems: [{ index: 1, name: 'Uncertain', enabled: false }] }] } });
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(result.build.className).toBeNull(); expect(result.build.classMismatch).toBe(true);
  expect(result.selectedSkill.name).toBeNull(); expect(result.selectedSkill.gems).toEqual([]); expect(result.referenceExamples.starter).toBeNull();
});

it('preserves unknown skill classifications and disabled group state', async () => {
  const { tool } = toolWith({ build: {}, tree: {}, skills: { mainSocketGroup: 1, groups: [{ index: 1, enabled: false, skills: [], gems: [{ index: 1, name: 'Uncertain', enabled: false }] }] } });
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(result.selectedSkill.name).toBeNull(); expect(result.selectedSkill.groupEnabled).toBe(false);
  expect(result.selectedSkill.gems[0].kind).toBe('unknown'); expect(result.selectedSkill.gems[0].appliedToSelectedSkill).toBeNull();
  await expect(tool.invoke({ snapshot_id: id, extra: true })).rejects.toThrow('snapshot ID');
});
