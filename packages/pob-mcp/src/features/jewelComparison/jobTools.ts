import { isDeepStrictEqual } from 'node:util';
import { normalizeObservation } from '../../foundation/observation.js';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { JewelEvaluationInput, JobRunner } from '../../foundation/jobRunner.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
export function jewelJobSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'submit_snapshot_jewels', description: 'Start a durable job to compare 1–10 explicit jewel candidates in an allocated socket. Each candidate produces a seven-day trial snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, socket_node_id: { type: 'integer', minimum: 1 }, fields: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string' } }, candidates: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, item_text: { type: 'string' } }, required: ['name', 'item_text'] } } }, required: ['snapshot_id', 'socket_node_id', 'fields', 'candidates'] } },
    { name: 'summarize_snapshot_jewels', description: 'Read jewel job results, errors, interrupted items and any recorded child snapshot IDs.', inputSchema: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  ];
}
export function createJewelJobTools(foundation: Pick<BuildFoundation, 'readSnapshot'>, jobs: Pick<JobRunner, 'submitJewels' | 'get'>): FeatureTool[] {
  const [submit, summary] = jewelJobSchemas();
  return [
    { schema: submit, invoke: async args => {
      if (Object.keys(args).some(key => !['snapshot_id', 'socket_node_id', 'fields', 'candidates'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !Number.isSafeInteger(args.socket_node_id) || (args.socket_node_id as number) < 1 || (args.socket_node_id as number) > 2147483647 || !Array.isArray(args.fields) || args.fields.length < 1 || args.fields.length > 20 || args.fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(args.fields).size !== args.fields.length || !Array.isArray(args.candidates) || args.candidates.length < 1 || args.candidates.length > 10 || args.candidates.some(e => !e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(key => !['name', 'item_text'].includes(key)) || typeof e.name !== 'string' || !e.name.trim() || e.name !== e.name.trim() || e.name.length > 100 || typeof e.item_text !== 'string' || !e.item_text.trim() || Buffer.byteLength(e.item_text, 'utf8') > 10240) || new Set(args.candidates.map(e => e.name)).size !== args.candidates.length) throw new Error('Invalid jewel job options');
      const snapshot = await foundation.readSnapshot(args.snapshot_id);
      const identity = Object.fromEntries(identityKeys.map(key => [key, snapshot[key] ?? null])) as JewelEvaluationInput['discoveryIdentity'];
      const inputs: JewelEvaluationInput[] = args.candidates.map(entry => ({ kind: 'jewel', snapshotId: args.snapshot_id as string, socketNodeId: args.socket_node_id as number, name: entry.name, itemText: entry.item_text, fields: args.fields as string[], discoveryIdentity: identity }));
      const job = await jobs.submitJewels(inputs);
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, status: job.status, snapshotId: args.snapshot_id, submitted: inputs.length, warnings: ['Validation and calculations run in the background; poll the job and check individual results.', 'Candidate text is stored locally in the job record.'] }) }] };
    } },
    { schema: summary, invoke: async args => {
      if (Object.keys(args).some(key => key !== 'job_id') || typeof args.job_id !== 'string') throw new Error('Valid jewel job ID is required');
      const job = await jobs.get(args.job_id), first = job.items[0]?.input as JewelEvaluationInput;
      if (!first || first.kind !== 'jewel' || !job.items.length || job.items.length > 10) throw new Error('Job is not a jewel comparison');
      let signature: unknown = undefined, mismatch = false;
      const results = job.items.map(item => {
        const input = item.input as JewelEvaluationInput;
        if (!input || input.kind !== 'jewel' || input.snapshotId !== first.snapshotId || input.socketNodeId !== first.socketNodeId || !isDeepStrictEqual(input.fields, first.fields) || !isDeepStrictEqual(input.discoveryIdentity, first.discoveryIdentity)) throw new Error('Invalid jewel job inputs');
        if (item.status !== 'completed') return { name: input.name, status: item.status, reason: item.error ?? null, snapshotId: item.progress?.snapshotId ?? null };
        const report = item.result as any, entry = report?.results?.[0];
        if (!report || report.snapshotId !== first.snapshotId || report.socketNodeId !== first.socketNodeId || !isDeepStrictEqual(report.fields, first.fields) || !Array.isArray(report.results) || report.results.length !== 1 || entry?.name !== input.name || !['compared', 'error'].includes(entry.status)) throw new Error('Invalid jewel job result');
        if (item.progress && entry.snapshot?.id !== item.progress.snapshotId) throw new Error('Jewel job snapshot progress mismatch');
        if (entry.status === 'error') return { ...entry, snapshotId: item.progress?.snapshotId ?? entry.snapshot?.id ?? null };
        const comparison = entry.comparison;
        if (!comparison || comparison.baseline?.snapshotId !== first.snapshotId || !entry.snapshot?.id || comparison.candidate?.snapshotId !== entry.snapshot.id || !comparison.metrics || typeof comparison.metrics !== 'object') throw new Error('Invalid jewel comparison result');
        const baseline = { identity: comparison.baseline.identity, context: normalizeObservation(comparison.baseline.context), metrics: Object.fromEntries(first.fields.map(field => [field, comparison.metrics[field]?.baseline ?? null])) };
        if (signature === undefined) signature = baseline; else if (!isDeepStrictEqual(signature, baseline)) mismatch = true;
        for (const key of identityKeys) if (first.discoveryIdentity[key] && comparison.baseline.identity?.[key] && first.discoveryIdentity[key] !== comparison.baseline.identity[key]) mismatch = true;
        return { ...entry, snapshotId: item.progress?.snapshotId ?? entry.snapshot?.id ?? null, currentDiagnostics: report.currentDiagnostics };
      });
      const safe = mismatch ? results.map((result: any) => result.status === 'compared' ? { ...result, status: 'unranked', comparison: { ...result.comparison, metrics: Object.fromEntries(Object.entries(result.comparison.metrics).map(([key, metric]) => [key, { ...(metric as object), status: 'incomparable', delta: null }])) }, reason: 'Baseline or engine identity differs between candidates' } : result) : results;
      const complete = job.status === 'completed' && !mismatch && safe.every((r: any) => r.status === 'compared' && Object.values(r.comparison.metrics).every((metric: any) => metric.status === 'available') && r.parseDiagnostics?.diagnostics?.unparsed?.length === 0 && (r.currentDiagnostics?.status === 'empty' || r.currentDiagnostics?.result?.diagnostics?.unparsed?.length === 0));
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, jobStatus: job.status, status: complete ? 'complete' : 'partial', snapshotId: first.snapshotId, socketNodeId: first.socketNodeId, fields: first.fields, baselineMismatch: mismatch, results: safe,
        warnings: ['Pending, failed, interrupted, incomparable, unparsed or unknown results make this report partial.', 'A derived snapshot is recoverable after its progress is persisted; interruption between snapshot creation and that write can still leave an unreferenced trial.', 'Trial snapshots expire after seven days unless retained. Cancellation stops after the current candidate.', 'PoB parsing, game legality, aura uptime, pricing and availability require separate verification.'] }) }] };
    } },
  ];
}
