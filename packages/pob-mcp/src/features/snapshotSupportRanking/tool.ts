import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
type Gem = Record<string, unknown> & { index: number };
type Group = Record<string, unknown> & { index: number; gems: Gem[] };
function skillGroup(value: unknown, groupIndex: number): { group: Group; selection: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PoB returned invalid skills');
  const skills = value as { mainSocketGroup?: number; groups?: Group[] };
  if (skills.mainSocketGroup !== groupIndex || !Array.isArray(skills.groups)) throw new Error('Requested group is not the main skill group');
  const group = skills.groups.find(entry => entry.index === groupIndex);
  if (!group || group.enabled !== true || group.slotEnabled !== true || !Array.isArray(group.gems) || group.gems.some((gem, i) => !gem || gem.index !== i + 1)) throw new Error('Main skill group or its equipment slot is unavailable');
  return { group, selection: { mainSocketGroup: skills.mainSocketGroup, mainActiveSkill: group.mainActiveSkill ?? null, selectedSkillPart: group.selectedSkillPart ?? null } };
}
export function supportRankingSchema(): FeatureTool['schema'] {
  return { name: 'rank_snapshot_supports', description: 'Replace one enabled support with explicit candidates in separate seven-day trial snapshots and compare one requested PoB metric. Only supports confirmed applied to the selected skill are ranked.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gem_index: { type: 'integer', minimum: 1 }, metric: { type: 'string' }, direction: { type: 'string', enum: ['higher', 'lower'] }, candidates: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, properties: { gem_name: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 } }, required: ['gem_name'] } } }, required: ['snapshot_id', 'group_index', 'gem_index', 'metric', 'candidates'] } };
}
export function createSnapshotSupportRankingTool(foundation: Pick<BuildFoundation, 'evaluate' | 'deriveSupportReplacement'>): FeatureTool {
  return { schema: supportRankingSchema(), invoke: async args => {
    const validInt = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
    const candidates = args.candidates;
    const validCandidate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const candidate = value as Record<string, unknown>;
      return Object.keys(candidate).every(key => ['gem_name', 'level', 'quality'].includes(key)) && typeof candidate.gem_name === 'string' && !!candidate.gem_name.trim() && candidate.gem_name.length <= 200 && (candidate.level === undefined || validInt(candidate.level, 1, 40)) && (candidate.quality === undefined || validInt(candidate.quality, 0, 99));
    };
    const direction = args.direction ?? 'higher';
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'gem_index', 'metric', 'direction', 'candidates'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !validInt(args.group_index, 1, 10000) || !validInt(args.gem_index, 1, 10000) || typeof args.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(args.metric) || !['higher', 'lower'].includes(direction as string) || !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 4 || candidates.some(candidate => !validCandidate(candidate))) throw new Error('Invalid support ranking options');
    const normalized = (name: string) => name.trim().toLowerCase().replace(/ support$/, '');
    const names = candidates.map(candidate => normalized(candidate.gem_name));
    if (new Set(names).size !== names.length) throw new Error('Duplicate support candidates');
    const id = args.snapshot_id, groupIndex = args.group_index as number, gemIndex = args.gem_index as number, metric = args.metric;
    const baseline = await foundation.evaluate(id, [metric]);
    const before = skillGroup(baseline.context.skills, groupIndex);
    const replaced = before.group.gems.find(gem => gem.index === gemIndex);
    if (!replaced || replaced.isSupport !== true || replaced.enabled !== true) throw new Error('Requested gem is not an enabled support');
    const baselineMetric = baseline.metrics[metric], base = baselineMetric?.status === 'available' && typeof baselineMetric.value === 'number' && Number.isFinite(baselineMetric.value) ? baselineMetric.value : null;
    const results: Array<Record<string, unknown> & { status: string; candidate: string; delta?: number | null }> = [];
    for (const candidate of candidates as Array<{ gem_name: string; level?: number; quality?: number }>) {
      let candidateId: string | undefined;
      try {
        const derived = await foundation.deriveSupportReplacement(id, groupIndex, gemIndex, { gemName: candidate.gem_name, ...(candidate.level === undefined ? {} : { level: candidate.level }), ...(candidate.quality === undefined ? {} : { quality: candidate.quality }) }, true);
        candidateId = derived.id;
        if (derived.parentId !== id) throw new Error('Candidate snapshot parent mismatch');
        const evaluated = await foundation.evaluate(derived.id, [metric]);
        const after = skillGroup(evaluated.context.skills, groupIndex), newGem = after.group.gems.find(gem => gem.index === gemIndex);
        const mismatched = identityKeys.filter(key => baseline.identity[key] && evaluated.identity[key] && baseline.identity[key] !== evaluated.identity[key]);
        const unknown = identityKeys.filter(key => !baseline.identity[key] || !evaluated.identity[key] || baseline.warnings.some(w => w.startsWith(`${key} is unknown;`)) || evaluated.warnings.some(w => w.startsWith(`${key} is unknown;`)));
        const measured = evaluated.metrics[metric], value = measured?.status === 'available' && typeof measured.value === 'number' && Number.isFinite(measured.value) ? measured.value : null;
        let reason: string | undefined;
        if (mismatched.length) reason = `PoB identity differs: ${mismatched.join(', ')}`;
        else if (!isDeepStrictEqual(baseline.context.config, evaluated.context.config) || !isDeepStrictEqual(before.selection, after.selection)) reason = 'Selected skill or configuration changed';
        else if (!newGem || newGem.isSupport !== true || newGem.enabled !== true) reason = 'Replacement support could not be confirmed';
        else if (newGem.appliedToSelectedSkill !== true) reason = newGem.appliedToSelectedSkill === false ? 'Support is not applied to the selected skill' : 'Support application is unknown';
        else if (base === null || value === null) reason = 'Requested metric is unavailable';
        const delta = base !== null && value !== null ? value - base : null;
        if (!reason && (delta === null || !Number.isFinite(delta))) reason = 'Metric difference is not finite';
        results.push({ candidate: candidate.gem_name, snapshotId: derived.id, status: reason ? 'unranked' : 'ok', gem: newGem ?? null, value, delta: reason ? null : delta,
          percent: reason || base === null || base === 0 || delta === null || !Number.isFinite(delta / base * 100) ? null : delta / base * 100, identity: evaluated.identity, identityUnknown: unknown, warnings: evaluated.warnings, ...(reason ? { reason } : {}) });
      } catch (error) { results.push({ candidate: candidate.gem_name, status: 'error', ...(candidateId ? { snapshotId: candidateId } : {}), reason: error instanceof Error ? error.message : String(error) }); }
    }
    const ranked = results.filter(result => result.status === 'ok').sort((a, b) => (direction === 'higher' ? (b.delta as number) - (a.delta as number) : (a.delta as number) - (b.delta as number)) || a.candidate.localeCompare(b.candidate)).map(result => result.candidate);
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: id, groupIndex, gemIndex, replaced: replaced.name ?? null, metric, direction, baseline: { value: base, identity: baseline.identity, context: baseline.context, warnings: baseline.warnings }, rankedCandidates: ranked, results,
      warnings: ['Only supplied candidates confirmed applied by PoB are ranked; a result is not a global optimum.', 'New supports default to level 20 and 0% quality; this does not verify gem availability, socket colours, equipment requirements, mana cost, defense or price.', 'Trial snapshots expire after seven days unless retained; the parent remains unchanged. Choose a metric that includes the intended player or minion damage and ailments.'] }) }] };
  } };
}
