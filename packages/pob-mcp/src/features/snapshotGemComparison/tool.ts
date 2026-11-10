import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const fields = ['TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS'];
const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
type SkillGroup = Record<string, unknown> & { index: number; gems: Array<Record<string, unknown>> };
type Skills = Record<string, unknown> & { mainSocketGroup: number; groups: SkillGroup[] };
const asSkills = (value: unknown): Skills => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PoB returned invalid skills');
  const skills = value as Skills;
  if (!Number.isSafeInteger(skills.mainSocketGroup) || !Array.isArray(skills.groups) || skills.groups.some((group, index) => !group || group.index !== index + 1 || !Array.isArray(group.gems))) throw new Error('PoB returned invalid skill groups');
  return skills;
};
function groupInvariant(skills: Skills, target: number) {
  const { groups, ...rest } = skills;
  return { ...rest, groups: groups.map(group => {
    const { gems, ...other } = group;
    if (group.index === target) { const { skills: _skills, ...properties } = other; return properties; }
    return { ...other, gems: gems.map(gem => { const { appliedToSelectedSkill: _applied, ...properties } = gem; return properties; }) };
  }) };
}
function activeGems(group: SkillGroup) {
  return group.gems.filter(gem => gem.isSupport === false).map(gem => ({ name: gem.name, enabled: gem.enabled }));
}
export function snapshotGemComparisonSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_gem_setups', description: 'Compare explicit descendant snapshots with changes limited to the saved main skill group. Returns separate PoB player and minion metrics, without ranking or assuming support compatibility.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, candidate_snapshot_ids: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string' } } }, required: ['snapshot_id', 'group_index', 'candidate_snapshot_ids'] } };
}
export function createSnapshotGemComparisonTool(foundation: Pick<BuildFoundation, 'readSnapshot' | 'inspect' | 'evaluate'>): FeatureTool {
  return { schema: snapshotGemComparisonSchema(), invoke: async args => {
    const validId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const candidates = args.candidate_snapshot_ids;
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'candidate_snapshot_ids'].includes(key)) || !validId(args.snapshot_id) || typeof args.group_index !== 'number' || !Number.isSafeInteger(args.group_index) || args.group_index < 1 || !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 3 || candidates.some(id => !validId(id)) || new Set(candidates).size !== candidates.length) throw new Error('Invalid snapshot gem comparison options');
    const parentId = args.snapshot_id as string, groupIndex = args.group_index;
    const original = await foundation.inspect(parentId, ['tree', 'items', 'skills', 'config']);
    const originalSkills = asSkills(original.data.skills), originalGroup = originalSkills.groups.find(group => group.index === groupIndex);
    if (originalSkills.mainSocketGroup !== groupIndex || !originalGroup || originalGroup.enabled !== true || originalGroup.slotEnabled !== true) throw new Error('Comparison requires the enabled saved main skill group in an active equipment slot');
    const active = activeGems(originalGroup);
    if (active.length !== 1 || active[0].enabled !== true || typeof active[0].name !== 'string') throw new Error('Comparison requires exactly one enabled active gem');
    const baseline = await foundation.evaluate(parentId, fields);
    if (!isDeepStrictEqual(original.data.skills, baseline.context.skills) || !isDeepStrictEqual(original.data.config, baseline.context.config)) throw new Error('Baseline skill or configuration changed between observations');
    if (identityKeys.some(key => original.identity[key] && baseline.identity[key] && original.identity[key] !== baseline.identity[key])) throw new Error('PoB identity changed during baseline observation');
    const results: Array<Record<string, unknown>> = [];
    for (const id of candidates as string[]) {
      try {
        let current = id, depth = 0;
        const visited = new Set<string>();
        while (current !== parentId) {
          if (depth++ >= 64 || visited.has(current)) throw new Error('Candidate snapshot ancestry exceeds the supported bound');
          visited.add(current);
          const metadata = await foundation.readSnapshot(current);
          if (!metadata.parentId) throw new Error('Candidate is not a descendant of the baseline snapshot');
          current = metadata.parentId;
        }
        const candidate = await foundation.inspect(id, ['tree', 'items', 'skills', 'config']);
        const candidateSkills = asSkills(candidate.data.skills), candidateGroup = candidateSkills.groups.find(group => group.index === groupIndex);
        for (const section of ['tree', 'items', 'config'] as const) if (!isDeepStrictEqual(original.data[section], candidate.data[section])) throw new Error(`Candidate changed unrelated ${section}`);
        if (!candidateGroup || !isDeepStrictEqual(groupInvariant(originalSkills, groupIndex), groupInvariant(candidateSkills, groupIndex)) || !isDeepStrictEqual(active, activeGems(candidateGroup))) throw new Error('Candidate changed the selected active skill or another skill group');
        const calculated = await foundation.evaluate(id, fields);
        if (!isDeepStrictEqual(candidate.data.skills, calculated.context.skills) || !isDeepStrictEqual(candidate.data.config, calculated.context.config)) throw new Error('Candidate skill or configuration changed between observations');
        const observations = [original, baseline, candidate, calculated];
        const mismatched = identityKeys.filter(key => new Set(observations.map(value => value.identity[key]).filter(Boolean)).size > 1);
        const unknown = identityKeys.filter(key => observations.some(value => !value.identity[key] || value.warnings.some(warning => warning.startsWith(`${key} is unknown;`))));
        if (mismatched.length) throw new Error(`PoB identity differs: ${mismatched.join(', ')}`);
        if (!isDeepStrictEqual(baseline.context.config, calculated.context.config)) throw new Error('PoB calculation configuration changed');
        const metrics = Object.fromEntries(fields.map(field => {
          const before = baseline.metrics[field], after = calculated.metrics[field];
          const difference = typeof before?.value === 'number' && before.status === 'available' && typeof after?.value === 'number' && after.status === 'available' ? after.value - before.value : null;
          return [field, { baseline: before ?? null, candidate: after ?? null, delta: difference !== null && Number.isFinite(difference) ? difference : null }];
        }));
        results.push({ snapshotId: id, status: 'ok', ancestryDepth: depth, gems: candidateGroup.gems, metrics, identity: calculated.identity, identityUnknown: unknown, warnings: calculated.warnings });
      } catch (error) { results.push({ snapshotId: id, status: 'error', error: error instanceof Error ? error.message : String(error) }); }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: parentId, groupIndex, activeGem: active[0].name, baseline: { identity: baseline.identity, context: baseline.context, metrics: baseline.metrics, warnings: baseline.warnings }, results,
      warnings: ['Only explicit descendant snapshots are compared; failed candidates are not ranked.', 'Player, minion and full DPS are separate PoB outputs and must not be added blindly. Check the selected metric, poison, skill uptime and configuration.', 'PoB support application is reported where available. This does not establish item or gem legality, socket colours, mana sustain, price or a global optimum.'] }) }] };
  } };
}
