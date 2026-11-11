import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { assessSkillGroup } from '../../domain/skillGroupAssessment.js';

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const integer = (value: unknown, minimum: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
export function skillInspectionSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_skill_groups', description: 'Inspect saved PoB skill groups and gem level, quality, enabled state and support application, with structured observations. Does not establish actual socket links, gem legality or rank damage.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, all_groups: { type: 'boolean' } }, required: ['snapshot_id'] } };
}
export function createSkillInspectionTool(foundation: Pick<BuildFoundation, 'inspect'>): FeatureTool {
  return { schema: skillInspectionSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'all_groups'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || (args.group_index !== undefined && (!integer(args.group_index, 1) || (args.group_index as number) > 10000)) || (args.all_groups !== undefined && typeof args.all_groups !== 'boolean') || (args.all_groups === true && args.group_index !== undefined)) throw new Error('Invalid skill inspection options');
    const observation = await foundation.inspect(args.snapshot_id, ['skills']);
    const skills = observation.data.skills;
    if (!object(skills) || !Array.isArray(skills.groups) || skills.groups.some((group: unknown, i: number) => !object(group) || group.index !== i + 1 || !Array.isArray(group.gems) || group.gems.some((gem: unknown, j: number) => !object(gem) || gem.index !== j + 1 || typeof gem.name !== 'string'))) throw new Error('PoB returned invalid skill groups');
    const mainGroup = integer(skills.mainSocketGroup, 1) ? skills.mainSocketGroup as number : null;
    const index = args.group_index === undefined ? mainGroup : args.group_index as number;
    const selected = args.all_groups === true ? skills.groups : skills.groups.filter((group: Record<string, unknown>) => group.index === index);
    if (args.all_groups !== true && (!index || selected.length !== 1)) throw new Error('Requested or selected skill group is unavailable');
    const groups = selected.map((group: Record<string, any>) => ({ index: group.index, label: typeof group.label === 'string' ? group.label : null, slot: typeof group.slot === 'string' ? group.slot : null, enabled: bool(group.enabled), slotEnabled: bool(group.slotEnabled), includeInFullDPS: bool(group.includeInFullDPS), selectedByBuild: mainGroup === null ? null : group.index === mainGroup, mainActiveSkill: integer(group.mainActiveSkill, 1) ? group.mainActiveSkill : null, selectedSkillPart: integer(group.selectedSkillPart, 1) ? group.selectedSkillPart : null, skills: Array.isArray(group.skills) && group.skills.every((name: unknown) => typeof name === 'string') ? group.skills : null,
      gems: group.gems.map((gem: Record<string, any>) => ({ index: gem.index, name: gem.name.trim() ? gem.name : null, kind: gem.name.trim() && gem.supportClassificationKnown === true && typeof gem.isSupport === 'boolean' ? gem.isSupport ? 'support' : 'active' : 'unknown', enabled: bool(gem.enabled), level: integer(gem.level, 1) ? gem.level : null, quality: integer(gem.quality, 0) ? gem.quality : null, qualityId: typeof gem.qualityId === 'string' && gem.qualityId ? gem.qualityId : null, count: integer(gem.count, 1) ? gem.count : null, appliedToSelectedSkill: bool(gem.appliedToSelectedSkill), enableGlobal1: bool(gem.enableGlobal1), enableGlobal2: bool(gem.enableGlobal2) })) }));
    const assessedGroups = groups.map((group: any) => ({ ...group, assessment: assessSkillGroup(group) }));
    const unknownGemTypes = assessedGroups.flatMap((group: { index: number; gems: Array<{ index: number; kind: string }> }) => group.gems.filter(gem => gem.kind === 'unknown').map(gem => ({ groupIndex: group.index, gemIndex: gem.index })));
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: observation.snapshotId, identity: observation.identity, mainGroupIndex: mainGroup, calcsGroupIndex: integer(skills.calcsSkillNumber, 1) ? skills.calcsSkillNumber : null, scope: args.all_groups === true ? 'all' : 'group', groups: assessedGroups, unknownGemTypes, warnings: [...observation.warnings, 'A support application flag concerns PoB’s selected skill and can be unknown; it is not a ranking or proof of in-game gem availability.', 'Enabled gem counts are observations, not proof of socket connections or available links.', 'Levels, quality and enabled states are PoB observations; corruption, socket legality, mana cost, price and quality benefit are not inferred.', 'Use foundation_compatible_supports for candidate compatibility and explicit snapshot comparisons for damage.'] }) }] };
  } };
}
