import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { JobRunner, MasteryEvaluationInput } from '../../foundation/jobRunner.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { enumerateMasteries } from './tool.js';

export function masteryJobSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'submit_snapshot_mastery_ranking', description: 'Start a durable local job to compare all discovered allocated mastery effects against one snapshot and one PoB metric. Cancellation is cooperative between candidates.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, metric: { type: 'string' }, direction: { type: 'string', enum: ['higher', 'lower'] }, include_current: { type: 'boolean' } }, required: ['snapshot_id', 'metric'] } },
    { name: 'summarize_snapshot_mastery_ranking', description: 'Summarize a mastery ranking job, retaining partial failures and ranking only observations with consistent baseline, snapshot, configuration and engine identity. Both result and ranking lists are paged.', inputSchema: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['job_id'] } },
  ];
}

export function createMasteryJobTools(foundation: Pick<BuildFoundation, 'masteryOptions'>, jobs: Pick<JobRunner, 'submitMasteries' | 'get'>): FeatureTool[] {
  const [submitSchema, summarySchema] = masteryJobSchemas();
  return [
    { schema: submitSchema, invoke: async args => {
      const direction = args.direction ?? 'higher';
      if (Object.keys(args).some(key => !['snapshot_id', 'metric', 'direction', 'include_current'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(args.metric) || !['higher', 'lower'].includes(direction as string) || (args.include_current !== undefined && typeof args.include_current !== 'boolean')) throw new Error('Invalid mastery job options');
      const snapshotId = args.snapshot_id, metric = args.metric;
      const source = await foundation.masteryOptions(snapshotId);
      const { effects, totalMasteries } = enumerateMasteries(source);
      const unknownCurrentNodes = [...new Set(effects.filter(effect => effect.selected === null).map(effect => effect.nodeId))];
      const inputs: MasteryEvaluationInput[] = effects.filter(effect => args.include_current === true || effect.selected !== true).map(effect => ({ kind: 'mastery', snapshotId, nodeId: effect.nodeId, effectId: effect.effectId, metric, direction: direction as 'higher' | 'lower', treeVersion: source.treeVersion, discoveryIdentity: source.identity, includeCurrent: args.include_current === true, selected: effect.selected, totalDiscovered: effects.length, totalMasteries }));
      if (inputs.length > 1000) throw new Error('More than 1000 mastery candidates; automatic job would exceed the supported bound');
      if (!inputs.length) return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, status: 'no_candidates', jobId: null, totalCandidates: 0, totalMasteries, treeVersion: source.treeVersion, identity: source.identity, warnings: source.warnings }) }] };
      const job = await jobs.submitMasteries(inputs);
      return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, jobId: job.id, status: job.status, totalCandidates: inputs.length, totalMasteries, treeVersion: source.treeVersion, identity: source.identity,
        includeCurrent: args.include_current === true, unknownCurrentNodes, warnings: [...source.warnings, ...(unknownCurrentNodes.length ? ['Current effect is unknown for some nodes; those options are included even when include_current is false.'] : []), 'Poll foundation_get_job or summarize_snapshot_mastery_ranking; cancel with foundation_cancel_job.'] }) }] };
    } },
    { schema: summarySchema, invoke: async args => {
      const offset = args.offset ?? 0, limit = args.limit ?? 50;
      if (Object.keys(args).some(key => !['job_id', 'offset', 'limit'].includes(key)) || typeof args.job_id !== 'string' || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647 || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid mastery job summary options');
      const job = await jobs.get(args.job_id);
      if (!Array.isArray(job.items) || !job.items.length) throw new Error('Invalid mastery job');
      const first = job.items[0].input as MasteryEvaluationInput;
      if (!first || first.kind !== 'mastery') throw new Error('Job is not a mastery ranking');
      if (typeof first.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(first.snapshotId) || typeof first.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(first.metric) || !['higher', 'lower'].includes(first.direction) || (first.treeVersion !== null && (typeof first.treeVersion !== 'string' || !first.treeVersion)) || !first.discoveryIdentity || typeof first.discoveryIdentity !== 'object' || Array.isArray(first.discoveryIdentity) || typeof first.includeCurrent !== 'boolean' || !Number.isSafeInteger(first.totalDiscovered) || first.totalDiscovered < job.items.length || !Number.isSafeInteger(first.totalMasteries) || first.totalMasteries < 1) throw new Error('Invalid mastery job inputs');
      let baseline: any, baselineMismatch = false;
      const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
      const identityUnknown = new Set<string>();
      if (!first.treeVersion) identityUnknown.add('treeVersion');
      for (const key of identityKeys) if (!first.discoveryIdentity[key]) identityUnknown.add(key);
      const results: Array<{ nodeId: number; effectId: number; status: string; delta?: number; [key: string]: unknown }> = [];
      const seen = new Set<string>();
      for (const item of job.items) {
        const input = item.input as MasteryEvaluationInput;
        if (!input || input.kind !== 'mastery' || input.snapshotId !== first.snapshotId || input.metric !== first.metric || input.direction !== first.direction || input.treeVersion !== first.treeVersion || input.includeCurrent !== first.includeCurrent || input.totalDiscovered !== first.totalDiscovered || input.totalMasteries !== first.totalMasteries || ![true, false, null].includes(input.selected) || (input.selected === true && !input.includeCurrent) || !isDeepStrictEqual(input.discoveryIdentity, first.discoveryIdentity) || !Number.isSafeInteger(input.nodeId) || input.nodeId < 1 || input.nodeId > 2147483647 || !Number.isSafeInteger(input.effectId) || input.effectId < 1 || input.effectId > 2147483647 || seen.has(`${input.nodeId}:${input.effectId}`)) throw new Error('Invalid mastery job inputs');
        seen.add(`${input.nodeId}:${input.effectId}`);
        if (item.status !== 'completed') { results.push({ nodeId: input.nodeId, effectId: input.effectId, status: item.status, ...(item.error ? { reason: item.error } : {}) }); continue; }
        const report = item.result as any;
        if (!report || report.snapshotId !== first.snapshotId || report.nodeId !== input.nodeId || report.metric !== first.metric || report.direction !== first.direction || !report.baseline || !report.baseline.identity || !Array.isArray(report.results) || report.results.length !== 1 || report.results[0]?.effectId !== input.effectId) throw new Error('Invalid mastery job result');
        if (!first.treeVersion || !report.treeVersion) identityUnknown.add('treeVersion');
        else if (first.treeVersion !== report.treeVersion) baselineMismatch = true;
        for (const key of identityKeys) {
          const original = first.discoveryIdentity?.[key], actual = report.baseline.identity[key];
          if (!original || !actual) identityUnknown.add(key);
          else if (original !== actual) baselineMismatch = true;
        }
        if (!baseline) baseline = report.baseline;
        else if (!isDeepStrictEqual(baseline, report.baseline)) baselineMismatch = true;
        const entry = report.results[0];
        if (!['ok', 'unranked', 'unavailable', 'error'].includes(entry.status) || (entry.status === 'ok' && (typeof entry.delta !== 'number' || !Number.isFinite(entry.delta)))) throw new Error('Invalid mastery job result');
        if (Array.isArray(entry.identityUnknown)) for (const key of entry.identityUnknown) if (typeof key === 'string') identityUnknown.add(key);
        results.push({ ...entry, nodeId: input.nodeId, effectId: input.effectId });
      }
      const ranked = baselineMismatch ? [] : results.filter(result => result.status === 'ok').sort((a, b) => (first.direction === 'higher' ? (b.delta as number) - (a.delta as number) : (a.delta as number) - (b.delta as number)) || a.nodeId - b.nodeId || a.effectId - b.effectId).map(result => ({ nodeId: result.nodeId, effectId: result.effectId, delta: result.delta }));
      const complete = job.status === 'completed' && !baselineMismatch && results.every(result => result.status === 'ok');
      const resultPage = results.slice(offset, offset + limit), rankedPage = ranked.slice(offset, offset + limit);
      const unknownCurrentNodes = [...new Set(job.items.map(item => item.input as MasteryEvaluationInput).filter(input => input.selected === null).map(input => input.nodeId))];
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, jobStatus: job.status, snapshotId: first.snapshotId, metric: first.metric, direction: first.direction, status: complete ? 'complete' : 'partial', baseline: baseline ?? null, baselineMismatch, identityUnknown: [...identityUnknown], includeCurrent: first.includeCurrent, unknownCurrentNodes, totalDiscovered: first.totalDiscovered, totalMasteries: first.totalMasteries, totalCandidates: results.length, totalRanked: ranked.length, offset,
        nextResultsOffset: offset + resultPage.length < results.length ? offset + resultPage.length : null, nextRankedOffset: offset + rankedPage.length < ranked.length ? offset + rankedPage.length : null, ranked: rankedPage, results: resultPage,
        warnings: ['Ranking covers the submitted candidates only. Pending, failed, cancelled or unrankable candidates make the result partial.', 'Trial snapshots expire after seven days unless retained; the parent is unchanged.', ...(unknownCurrentNodes.length ? ['Current effect is unknown for some nodes; those options may include the current choice.'] : []), ...(['queued', 'running', 'cancel_requested'].includes(job.status) ? ['Ranking order can change while the job is running; page through the final result after the job ends.'] : []), ...(baselineMismatch ? ['Baseline or discovery identities differed; no cross-candidate ranking is returned.'] : []), ...(identityUnknown.size ? ['Some engine or tree identities are unknown; cross-candidate compatibility is unverified.'] : [])] }) }] };
    } },
  ];
}
