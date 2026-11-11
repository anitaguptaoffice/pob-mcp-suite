import { ACT_MILESTONES, ASCENDANCY_UNLOCK, CLASS_STARTER_SKILLS } from '../../domain/levelingReference.js';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const flag = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const positive = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

export function levelingSchema(): FeatureTool['schema'] {
  return { name: 'prepare_snapshot_leveling', description: 'Read a snapshot’s class, ascendancy and selected skill and provide separately labeled unverified campaign examples. Does not establish current gem availability, quest rewards, leveling routes or build legality.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}

export function createLevelingTool(foundation: Pick<BuildFoundation, 'inspect'>): FeatureTool {
  return { schema: levelingSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Valid snapshot ID is required');
    const observed = await foundation.inspect(args.snapshot_id, ['build', 'tree', 'skills']);
    const { build, tree, skills } = observed.data;
    if (!record(build) || !record(tree) || !record(skills) || !Array.isArray(skills.groups) || skills.groups.some((group: unknown, i: number) => !record(group) || group.index !== i + 1 || !Array.isArray(group.gems))) throw new Error('PoB returned invalid leveling context');
    const buildClass = text(build.className), treeClass = text(tree.className);
    const classMismatch = !!buildClass && !!treeClass && buildClass !== treeClass;
    const className = classMismatch ? null : treeClass ?? buildClass;
    const buildAscendancy = text(build.ascendClassName), treeAscendancy = text(tree.ascendClassName);
    const ascendancyMismatch = !!buildAscendancy && !!treeAscendancy && buildAscendancy !== treeAscendancy;
    const ascendancy = ascendancyMismatch ? null : treeAscendancy ?? buildAscendancy;
    const mainGroupIndex = positive(skills.mainSocketGroup);
    const group = mainGroupIndex === null ? undefined : skills.groups.find((candidate: Record<string, unknown>) => candidate.index === mainGroupIndex);
    const activeIndex = group ? positive(group.mainActiveSkill) ?? (group.mainActiveSkill == null ? 1 : null) : null;
    const skill = group && activeIndex && Array.isArray(group.skills) ? text(group.skills[activeIndex - 1]) : null;
    const gems = group ? group.gems.map((gem: unknown, index: number) => {
      if (!record(gem) || gem.index !== index + 1) throw new Error('PoB returned invalid leveling gem data');
      const kind = gem.supportClassificationKnown === true && typeof gem.isSupport === 'boolean' ? gem.isSupport ? 'support' : 'active' : 'unknown';
      return { index: gem.index, name: text(gem.name), kind, enabled: flag(gem.enabled), appliedToSelectedSkill: flag(gem.appliedToSelectedSkill), level: positive(gem.level) };
    }) : [];
    const starter = className && Object.hasOwn(CLASS_STARTER_SKILLS, className) ? CLASS_STARTER_SKILLS[className] : null;
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: observed.snapshotId, identity: observed.identity,
      build: { className, ascendancy, treeVersion: text(tree.treeVersion), level: positive(build.level), classSources: { build: buildClass, tree: treeClass }, ascendancySources: { build: buildAscendancy, tree: treeAscendancy }, classMismatch, ascendancyMismatch },
      selectedSkill: { groupIndex: mainGroupIndex, activeIndex, name: skill, groupEnabled: group ? flag(group.enabled) : null, slotEnabled: group ? flag(group.slotEnabled) : null, gems },
      referenceExamples: { status: 'unverified', version: null, starter, milestones: ACT_MILESTONES, ascendancyLevels: ASCENDANCY_UNLOCK,
        linkProgression: [{ levels: '1-12', links: 2, example: 'main skill + Onslaught' }, { levels: '12-28', links: 3, example: 'main skill + 2 supports' }, { levels: '28-50', links: 4, example: 'main skill + 3 supports' }, { levels: '50-70', links: 5, example: 'main skill + 4 supports' }, { levels: 'endgame', links: 6, example: 'main skill + 5 supports' }],
        notes: ['Reference switch guidance is level 12–18; actual availability is not verified.', 'Reference vendor recipe example: magic weapon + rustic sash + blacksmith\'s whetstone for a physical damage weapon.', 'Reference suggestions include movement speed boots, resistance gearing, ascendancy progression and leveling spare gems in a weapon swap.', 'Reference passive priorities are damage, life, resistance, ascendancy and jewel sockets; they are generic and not a route for this build.'] },
      warnings: [...observed.warnings, 'Selected skill is taken from PoB’s selected active skill list; a missing or disabled selection is not replaced with a guessed gem.', 'The reference examples are unversioned, may be outdated or incompatible with this build, and does not establish gem rewards, recipes, support compatibility, quest progress, ascendancy timing or passive allocation.', 'Do not present example levels, links or starter skills as verified availability; consult current game data and explicit user progress.'] }) }] };
  } };
}
