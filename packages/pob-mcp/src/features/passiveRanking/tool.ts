import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { JobRunner, PassiveEvaluationInput } from '../../foundation/jobRunner.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { createTreePathTools } from '../treePaths/tool.js';

const identities = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
export function passiveRankingSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'submit_snapshot_passive_ranking', description: 'Find nearby reachable notable and keystone paths and start isolated PoB evaluations. Metrics must increase when improving; score is the sum of relative gains per passive point. Excluded nodes cannot occur anywhere on a submitted path.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, metrics: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string' } }, max_distance: { type: 'integer', minimum: 1, maximum: 100 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, filter: { type: 'string', maxLength: 200 }, excluded_node_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 2147483647 } } }, required: ['snapshot_id', 'metrics'] } },
    { name: 'summarize_snapshot_passive_ranking', description: 'Read passive ranking job progress, failures and relative gains per point.', inputSchema: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  ];
}

export async function evaluatePassive(foundation: Pick<BuildFoundation, 'deriveTree' | 'evaluate'>, input: PassiveEvaluationInput) {
  const baseline = await foundation.evaluate(input.snapshotId, input.metrics);
  const child = await foundation.deriveTree(input.snapshotId, input.pathNodes, [], {}, true);
  try { return { baseline, candidate: await foundation.evaluate(child.id, input.metrics), candidateSnapshotId: child.id }; }
  catch (error) { return { baseline, candidateSnapshotId: child.id, error: error instanceof Error ? error.message : String(error) }; }
}

export function createPassiveRankingTools(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, jobs: Pick<JobRunner, 'submitPassives' | 'get'>): FeatureTool[] {
  const [submit, summary] = passiveRankingSchemas();
  return [
    { schema: submit, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'metrics', 'max_distance', 'limit', 'filter', 'excluded_node_ids'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !Array.isArray(args.metrics) || args.metrics.length < 1 || args.metrics.length > 2 || args.metrics.some(metric => typeof metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(metric)) || new Set(args.metrics).size !== args.metrics.length || (args.excluded_node_ids !== undefined && (!Array.isArray(args.excluded_node_ids) || args.excluded_node_ids.length > 100 || args.excluded_node_ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) || new Set(args.excluded_node_ids).size !== args.excluded_node_ids.length))) throw new Error('Invalid passive ranking options');
      const excludedNodeIds = (args.excluded_node_ids ?? []) as number[];
      const nearby = createTreePathTools(foundation).find(tool => tool.schema.name === 'find_snapshot_nearby_nodes')!;
      const options: Record<string, unknown> = { snapshot_id: args.snapshot_id };
      for (const key of ['max_distance', 'limit', 'filter']) if (args[key] !== undefined) options[key] = args[key];
      const response = await nearby.invoke(options);
      const source = JSON.parse((response.content[0] as { text: string }).text);
      const eligible = source.nodes.filter((node: { isBlighted: boolean; ascendancyName?: string }) => !node.isBlighted && !node.ascendancyName);
      const suitable = eligible.filter((node: { pathNodes: number[] }) => !node.pathNodes.some(id => excludedNodeIds.includes(id)));
      const excludedPaths = eligible.length - suitable.length;
      const excludedBlighted = source.nodes.filter((node: { isBlighted: boolean }) => node.isBlighted).length;
      const excludedAscendancy = source.nodes.filter((node: { isBlighted: boolean; ascendancyName?: string }) => !node.isBlighted && !!node.ascendancyName).length;
      const inputs: PassiveEvaluationInput[] = suitable.map((node: { id: number; name: string; pathNodes: number[] }) => ({ kind: 'passive', snapshotId: args.snapshot_id as string, nodeId: node.id, nodeName: node.name, pathNodes: node.pathNodes, metrics: args.metrics as string[], discoveryIdentity: source.identity, treeVersion: source.treeVersion, excludedNodeIds }));
      if (!inputs.length) return { content: [{ type: 'text', text: JSON.stringify({ jobId: null, status: 'no_candidates', totalFound: source.total, excludedBlighted, excludedAscendancy, excludedNodeIds, excludedPaths, warnings: [...source.warnings, 'Exclusions apply after bounded discovery; alternate paths are not searched.'] }) }] };
      const job = await jobs.submitPassives(inputs);
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, status: job.status, snapshotId: args.snapshot_id, treeVersion: source.treeVersion, totalFound: source.total, submitted: inputs.length, excludedBlighted, excludedAscendancy, excludedNodeIds, excludedPaths, warnings: [...source.warnings, 'Search is limited by distance, filter and limit; exclusions apply after bounded discovery and alternate paths are not searched.'] }) }] };
    } },
    { schema: summary, invoke: async args => {
      if (Object.keys(args).some(key => key !== 'job_id') || typeof args.job_id !== 'string') throw new Error('Invalid passive job ID');
      const job = await jobs.get(args.job_id), first = job.items[0]?.input as PassiveEvaluationInput;
      if (!first || first.kind !== 'passive' || !job.items.length || job.items.length > 100) throw new Error('Job is not a passive ranking');
      if (first.excludedNodeIds !== undefined && (!Array.isArray(first.excludedNodeIds) || first.excludedNodeIds.length > 100 || first.excludedNodeIds.some(id => !Number.isSafeInteger(id) || id < 1 || id > 2147483647) || new Set(first.excludedNodeIds).size !== first.excludedNodeIds.length)) throw new Error('Invalid passive ranking inputs');
      let baseline: any, mismatch = false;
      const identityUnknown = new Set<string>();
      const results = job.items.map(item => {
        const input = item.input as PassiveEvaluationInput;
        if (!input || input.kind !== 'passive' || input.snapshotId !== first.snapshotId || input.treeVersion !== first.treeVersion || !isDeepStrictEqual(input.metrics, first.metrics) || !isDeepStrictEqual(input.discoveryIdentity, first.discoveryIdentity) || !isDeepStrictEqual(input.excludedNodeIds ?? [], first.excludedNodeIds ?? []) || !Array.isArray(input.pathNodes) || input.pathNodes.some(id => (input.excludedNodeIds ?? []).includes(id))) throw new Error('Invalid passive ranking inputs');
        const common = { nodeId: input.nodeId, nodeName: input.nodeName, pathNodes: input.pathNodes, pointCost: input.pathNodes.length };
        if (item.status !== 'completed') return { ...common, status: item.status, reason: item.error };
        const report = item.result as any;
        if (!report?.baseline || report.baseline.snapshotId !== input.snapshotId || typeof report.candidateSnapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(report.candidateSnapshotId)) throw new Error('Invalid passive ranking result');
        if (!baseline) baseline = report.baseline; else if (!isDeepStrictEqual(baseline, report.baseline)) mismatch = true;
        for (const key of identities) {
          const known = [input.discoveryIdentity[key], report.baseline.identity?.[key], report.candidate?.identity?.[key]];
          if (known.some(value => !value) || report.baseline.warnings?.some((warning: string) => warning.startsWith(`${key} is unknown;`)) || report.candidate?.warnings?.some((warning: string) => warning.startsWith(`${key} is unknown;`))) identityUnknown.add(key);
          if (new Set(known.filter(Boolean)).size > 1) mismatch = true;
        }
        if (report.error) return { ...common, status: 'error', snapshotId: report.candidateSnapshotId, reason: report.error };
        if (report.candidate?.snapshotId !== report.candidateSnapshotId || !isDeepStrictEqual(report.baseline.context, report.candidate.context)) return { ...common, status: 'unranked', snapshotId: report.candidateSnapshotId, reason: 'Calculation context changed or candidate identity is invalid' };
        let score = 0; const metrics: Record<string, unknown> = {};
        for (const name of input.metrics) {
          const before = report.baseline.metrics?.[name], after = report.candidate.metrics?.[name];
          if (before?.status !== 'available' || after?.status !== 'available' || typeof before.value !== 'number' || !Number.isFinite(before.value) || before.value <= 0 || typeof after.value !== 'number' || !Number.isFinite(after.value)) return { ...common, status: 'unavailable', snapshotId: report.candidateSnapshotId, reason: `Metric ${name} is unavailable or baseline is nonpositive` };
          const delta = after.value - before.value, relative = delta / before.value;
          if (!Number.isFinite(relative)) return { ...common, status: 'unavailable', snapshotId: report.candidateSnapshotId, reason: `Metric ${name} produced a nonfinite relative change` };
          metrics[name] = { baseline: before.value, candidate: after.value, delta, relative }; score += relative / input.pathNodes.length;
        }
        if (!Number.isFinite(score)) return { ...common, status: 'unavailable', snapshotId: report.candidateSnapshotId, reason: 'Combined score is not finite' };
        return { ...common, status: 'ok', snapshotId: report.candidateSnapshotId, score, metrics };
      });
      const safeResults = mismatch ? results.map(result => result.status === 'ok' ? { ...result, status: 'unranked', score: null, metrics: null, reason: 'Baseline or engine identity differs across observations' } : result) : results;
      const ranked = safeResults.filter(result => result.status === 'ok' && 'score' in result).sort((a, b) => (('score' in b ? b.score : 0) as number) - (('score' in a ? a.score : 0) as number) || a.nodeId - b.nodeId);
      const status = job.status === 'completed' && !mismatch && safeResults.every(result => result.status === 'ok') ? 'complete' : 'partial';
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, jobStatus: job.status, status, snapshotId: first.snapshotId, treeVersion: first.treeVersion, metrics: first.metrics, excludedNodeIds: first.excludedNodeIds ?? [], baseline: baseline ?? null, baselineMismatch: mismatch, identityUnknown: [...identityUnknown], ranked, results: safeResults, warnings: ['Scores are summed relative gains per passive point; use metrics where higher is better. Results cover only discovered paths, not the entire tree.', 'Check path legality, available points, game mechanics and trial retention before applying. Mastery effects are not selected.', ...(identityUnknown.size ? ['Some engine identities are unknown; compatibility is unverified.'] : []), ...(mismatch ? ['Baseline or engine identity differs; ranking withheld.'] : [])] }) }] };
    } },
  ];
}
