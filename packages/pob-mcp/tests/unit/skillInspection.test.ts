import { createSkillInspectionTool } from '../../src/features/skillInspection/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64);
function setup(skills: unknown) {
  const inspect = jest.fn().mockResolvedValue({ snapshotId: id, identity: { engineVersion: '1' }, warnings: [], data: { skills } });
  return { inspect, tool: createSkillInspectionTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>) };
}
const skills = { mainSocketGroup: 2, calcsSkillNumber: 1, groups: [
  { index: 1, label: 'disabled', enabled: false, slotEnabled: true, gems: [{ index: 1, name: '', enabled: false, isSupport: false, supportClassificationKnown: true, level: 1, quality: 0 }] },
  { index: 2, enabled: true, slotEnabled: true, skills: ['Summon'], mainActiveSkill: 1, gems: [
    { index: 1, name: 'Summon', enabled: true, isSupport: false, supportClassificationKnown: true, level: 20, quality: 10, qualityId: 'Default' },
    { index: 2, name: 'Support', enabled: true, isSupport: true, supportClassificationKnown: true, appliedToSelectedSkill: false, level: 19, quality: 0 },
    { index: 3, name: 'Unknown', enabled: true, isSupport: false, supportClassificationKnown: false },
  ] },
] };
it('defaults to the saved main group and preserves explicit support application and unknown classification', async () => {
  const test = setup(skills), report = JSON.parse((await test.tool.invoke({ snapshot_id: id })).content[0].text);
  expect(report.mainGroupIndex).toBe(2); expect(report.calcsGroupIndex).toBe(1); expect(report.groups).toHaveLength(1);
  expect(report.groups[0].gems.map((gem: { kind: string }) => gem.kind)).toEqual(['active', 'support', 'unknown']);
  expect(report.groups[0].gems[1]).toMatchObject({ appliedToSelectedSkill: false, level: 19, quality: 0 });
  expect(report.groups[0].gems[2]).toMatchObject({ level: null, quality: null, appliedToSelectedSkill: null });
  expect(report.unknownGemTypes).toEqual([{ groupIndex: 2, gemIndex: 3 }]);
  expect(test.inspect).toHaveBeenCalledWith(id, ['skills']);
});
it('returns disabled and empty-name gems when explicitly inspecting all groups', async () => {
  const test = setup(skills), report = JSON.parse((await test.tool.invoke({ snapshot_id: id, all_groups: true })).content[0].text);
  expect(report.groups[0]).toMatchObject({ enabled: false, selectedByBuild: false });
  expect(report.groups[0].gems[0]).toMatchObject({ name: null, kind: 'unknown', enabled: false });
});
it('rejects missing selections, inconsistent indices and conflicting scope options', async () => {
  const test = setup(skills);
  await expect(test.tool.invoke({ snapshot_id: id, group_index: 3 })).rejects.toThrow('unavailable');
  await expect(test.tool.invoke({ snapshot_id: id, all_groups: true, group_index: 1 })).rejects.toThrow('Invalid');
  const invalid = setup({ ...skills, groups: [{ index: 2, gems: [] }] });
  await expect(invalid.tool.invoke({ snapshot_id: id, all_groups: true })).rejects.toThrow('invalid skill groups');
});
