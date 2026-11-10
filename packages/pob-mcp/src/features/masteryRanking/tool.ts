import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
export function masteryDiscoverySchema(): FeatureTool['schema'] {
  return { name: 'discover_snapshot_mastery_effects', description: 'List and page all PoB effect options for allocated mastery nodes in an immutable snapshot; results are not ranked or verified as allocatable.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['snapshot_id'] } };
}

export function createMasteryDiscoveryTool(foundation: Pick<BuildFoundation, 'masteryOptions'>): FeatureTool {
  return { schema: masteryDiscoverySchema(), invoke: async args => {
    const offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (Object.keys(args).some(key => !['snapshot_id', 'offset', 'limit'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647 || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid mastery discovery options');
    const source = await foundation.masteryOptions(args.snapshot_id);
    const effects: Array<{ nodeId: number; nodeName: string | null; effectId: number; stat: string | null; selected: boolean }> = [];
    const nodes = new Set<number>();
    for (const mastery of source.masteries) {
      if (!mastery || !['number', 'string'].includes(typeof mastery.nodeId) || (typeof mastery.nodeId === 'string' && !/^[1-9]\d*$/.test(mastery.nodeId))) throw new Error('PoB returned invalid mastery discovery data');
      const nodeId = Number(mastery.nodeId);
      if (!Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > 2147483647 || nodes.has(nodeId) || !Array.isArray(mastery.availableEffects)) throw new Error('PoB returned invalid mastery discovery data');
      nodes.add(nodeId);
      const seen = new Set<number>();
      for (const effect of mastery.availableEffects) {
        if (!effect || !Number.isSafeInteger(effect.effectId) || effect.effectId < 1 || effect.effectId > 2147483647 || seen.has(effect.effectId) || (effect.stat !== undefined && typeof effect.stat !== 'string')) throw new Error('PoB returned invalid mastery discovery data');
        seen.add(effect.effectId);
        effects.push({ nodeId, nodeName: typeof mastery.nodeName === 'string' ? mastery.nodeName : null, effectId: effect.effectId, stat: effect.stat ?? null, selected: effect.effectId === mastery.allocatedEffect });
      }
    }
    effects.sort((a, b) => a.nodeId - b.nodeId || a.effectId - b.effectId);
    const page = effects.slice(offset, offset + limit);
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: source.snapshotId, treeVersion: source.treeVersion, identity: source.identity, totalMasteries: nodes.size, totalEffects: effects.length, offset, nextOffset: offset + page.length < effects.length ? offset + page.length : null, effects: page,
      warnings: [...source.warnings, 'Options are not ranked or verified as available together; use rank_snapshot_mastery_effects on one node and metric to evaluate bounded batches.'] }) }] };
  } };
}
export function masteryRankingSchema(): FeatureTool['schema'] {
  return { name: 'rank_snapshot_mastery_effects', description: 'Compare up to four effects for an allocated mastery against one immutable snapshot. Omit effect_ids to discover and page PoB options; results rank only the current page. Each candidate creates a seven-day trial snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, node_id: { type: 'integer', minimum: 1 }, effect_ids: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, metric: { type: 'string' }, direction: { type: 'string', enum: ['higher', 'lower'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 4 },
  }, required: ['snapshot_id', 'node_id', 'metric'] } };
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
    const requested = args.effect_ids, metric = args.metric, direction = args.direction ?? 'higher', offset = args.offset ?? 0, limit = args.limit ?? 4;
    if (Object.keys(args).some(key => !['snapshot_id', 'node_id', 'effect_ids', 'metric', 'direction', 'offset', 'limit'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !positive(args.node_id) || (requested !== undefined && (!Array.isArray(requested) || requested.length < 1 || requested.length > 4 || requested.some(id => !positive(id)) || new Set(requested).size !== requested.length || args.offset !== undefined || args.limit !== undefined)) || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647 || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 4 || typeof metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(metric) || !['higher', 'lower'].includes(direction as string)) throw new Error('Invalid mastery ranking options');
    const id = args.snapshot_id, nodeId = args.node_id as number;
    const options = await foundation.masteryNodeOptions(id, nodeId);
    if (!options.allocated) throw new Error('The requested mastery node is not allocated');
    if (!Array.isArray(options.availableEffects) || options.availableEffects.some(effect => !effect || !positive(effect.effectId) || typeof effect.stat !== 'string') || new Set(options.availableEffects.map(effect => effect.effectId)).size !== options.availableEffects.length) throw new Error('PoB returned invalid mastery options');
    const available = new Map(options.availableEffects.map(effect => [effect.effectId, effect.stat]));
    const allIds = [...available.keys()].sort((a, b) => a - b);
    const effects: number[] = requested === undefined ? allIds.slice(offset, offset + limit) : requested as number[];
    const nextOffset = requested === undefined && offset + effects.length < allIds.length ? offset + effects.length : null;
    const baseline = await foundation.evaluate(id, [metric]);
    const baseValue = metricValue(baseline, metric);
    const baselineSkill = selectedSkill(baseline.context.skills);
    const results: Array<Record<string, unknown> & { status: string; effectId: number; delta?: number | null }> = [];
    for (const effect of effects) {
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
      candidateScope: requested === undefined ? 'discovered_page' : 'explicit', totalAvailableEffects: allIds.length, offset: requested === undefined ? offset : null, nextOffset,
      baseline: { value: baseValue, identity: baseline.identity, context: baseline.context, warnings: baseline.warnings }, rankedEffectIds: ranked, results,
      warnings: [...options.warnings, 'Only this page or the supplied effects are compared; unavailable or failed candidates are not ranked. A page ranking is not a global ranking.', 'Trial snapshots expire after seven days unless explicitly retained; their parent is unchanged.', 'Ranking compares one selected metric under the saved skill and configuration; it does not assess other damage, defenses, price, play style or legality.'] }) }] };
  } };
}
