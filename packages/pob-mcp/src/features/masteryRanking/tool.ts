import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
export function masteryRankingSchema(): FeatureTool['schema'] {
  return { name: 'rank_snapshot_mastery_effects', description: 'Compare up to four explicit effects for an allocated mastery against one immutable snapshot, using one explicitly named PoB metric. Each candidate creates a seven-day trial snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, node_id: { type: 'integer', minimum: 1 }, effect_ids: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, metric: { type: 'string' }, direction: { type: 'string', enum: ['higher', 'lower'] },
  }, required: ['snapshot_id', 'node_id', 'effect_ids', 'metric'] } };
}

type Evaluation = Awaited<ReturnType<BuildFoundation['evaluate']>>;
function selectedSkill(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const skills = value as { mainSocketGroup?: unknown; groups?: Array<{ index?: unknown; mainActiveSkill?: unknown; selectedSkillPart?: unknown }> };
  if (!Array.isArray(skills.groups)) return null;
  if (skills.groups.length === 0) return { state: 'no_skill_groups' };
  if (typeof skills.mainSocketGroup !== 'number') return null;
  const group = skills.groups.find(entry => entry.index === skills.mainSocketGroup);
  if (!group) return null;
  return { mainSocketGroup: skills.mainSocketGroup, mainActiveSkill: group.mainActiveSkill ?? null, selectedSkillPart: group.selectedSkillPart ?? null };
}
function metricValue(evaluation: Evaluation, metric: string): number | null {
  const entry = evaluation.metrics[metric];
  return entry?.status === 'available' && typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null;
}

export function createMasteryRankingTool(foundation: Pick<BuildFoundation, 'masteryNodeOptions' | 'deriveMasteries' | 'evaluate'>): FeatureTool {
  return { schema: masteryRankingSchema(), invoke: async args => {
    const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
    const effects = args.effect_ids, metric = args.metric, direction = args.direction ?? 'higher';
    if (Object.keys(args).some(key => !['snapshot_id', 'node_id', 'effect_ids', 'metric', 'direction'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !positive(args.node_id) || !Array.isArray(effects) || effects.length < 1 || effects.length > 4 || effects.some(id => !positive(id)) || new Set(effects).size !== effects.length || typeof metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(metric) || !['higher', 'lower'].includes(direction as string)) throw new Error('Invalid mastery ranking options');
    const id = args.snapshot_id, nodeId = args.node_id as number;
    const options = await foundation.masteryNodeOptions(id, nodeId);
    if (!options.allocated) throw new Error('The requested mastery node is not allocated');
    const available = new Map(options.availableEffects.map(effect => [effect.effectId, effect.stat]));
    const baseline = await foundation.evaluate(id, [metric]);
    const baseValue = metricValue(baseline, metric);
    const baselineSkill = selectedSkill(baseline.context.skills);
    const results: Array<Record<string, unknown> & { status: string; effectId: number; delta?: number | null }> = [];
    for (const effect of effects as number[]) {
      if (!available.has(effect)) { results.push({ effectId: effect, status: 'unavailable', reason: 'Effect is not among PoB options for this node' }); continue; }
      let candidateId: string | undefined;
      try {
        const candidate = await foundation.deriveMasteries(id, { [nodeId]: effect }, true);
        candidateId = candidate.id;
        if (candidate.parentId !== id) throw new Error('Candidate snapshot parent mismatch');
        const changed = await foundation.evaluate(candidate.id, [metric]);
        const value = metricValue(changed, metric);
        const observations = [options, baseline, changed];
        const mismatchedIdentity = identityKeys.filter(key => new Set(observations.map(o => o.identity[key]).filter(Boolean)).size > 1);
        const unknownIdentity = identityKeys.filter(key => observations.some(o => !o.identity[key] || o.warnings.some(w => w.startsWith(`${key} is unknown;`))));
        const candidateSkill = selectedSkill(changed.context.skills);
        let reason: string | undefined;
        if (mismatchedIdentity.length) reason = `PoB identity differs: ${mismatchedIdentity.join(', ')}`;
        else if (!isDeepStrictEqual(baseline.context.config, changed.context.config)) reason = 'PoB configuration changed';
        else if (baselineSkill === null || candidateSkill === null) reason = 'Selected skill context is unknown';
        else if (!isDeepStrictEqual(baselineSkill, candidateSkill)) reason = 'Selected skill context changed';
        else if (baseValue === null || value === null) reason = 'Requested metric is unavailable';
        const delta = baseValue !== null && value !== null ? value - baseValue : null;
        if (!reason && (delta === null || !Number.isFinite(delta))) reason = 'Metric difference is not finite';
        results.push({ effectId: effect, effect: available.get(effect), snapshotId: candidate.id, status: reason ? 'unranked' : 'ok', value, delta: reason ? null : delta,
          percent: reason || baseValue === null || baseValue === 0 || delta === null || !Number.isFinite(delta / baseValue * 100) ? null : delta / baseValue * 100,
          identity: changed.identity, identityUnknown: unknownIdentity, warnings: changed.warnings, ...(reason ? { reason } : {}) });
      } catch (error) { results.push({ effectId: effect, effect: available.get(effect), status: 'error', ...(candidateId ? { snapshotId: candidateId } : {}), reason: error instanceof Error ? error.message : String(error) }); }
    }
    const ranked = results.filter(result => result.status === 'ok').sort((a, b) => (direction === 'higher' ? (b.delta as number) - (a.delta as number) : (a.delta as number) - (b.delta as number)) || a.effectId - b.effectId).map(result => result.effectId);
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: id, nodeId, treeVersion: options.treeVersion, currentEffect: options.allocatedEffect ?? null, metric, direction,
      baseline: { value: baseValue, identity: baseline.identity, context: baseline.context, warnings: baseline.warnings }, rankedEffectIds: ranked, results,
      warnings: [...options.warnings, 'Only the supplied effects are compared; unavailable or failed candidates are not ranked.', 'Trial snapshots expire after seven days unless explicitly retained; their parent is unchanged.', 'Ranking compares one selected metric under the saved skill and configuration; it does not assess other damage, defenses, price, play style or legality.'] }) }] };
  } };
}
