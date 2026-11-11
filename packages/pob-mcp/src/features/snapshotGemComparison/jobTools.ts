import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { GemSetupEvaluationInput, JobRunner } from '../../foundation/jobRunner.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
const keys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;

export function gemSetupJobSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'submit_snapshot_gem_setups', description: 'Start a durable job to derive and compare 2–5 explicit full main-skill gem setups from one snapshot. Each candidate is a seven-day trial.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, setups: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, gems: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { gemName: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 }, enabled: { type: 'boolean' } }, required: ['gemName'] } } }, required: ['name', 'gems'] } } }, required: ['snapshot_id', 'group_index', 'setups'] } },
    { name: 'summarize_snapshot_gem_setups', description: 'Summarize a gem-setup job, preserving failed and pending setups and rejecting comparisons when baseline or engine identity differs.', inputSchema: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  ];
}
export function createGemSetupJobTools(foundation: Pick<BuildFoundation, 'inspect'>, jobs: Pick<JobRunner, 'submitGemSetups' | 'get'>): FeatureTool[] {
  const [submit, summary] = gemSetupJobSchemas();
  return [
    { schema: submit, invoke: async args => {
      const positive = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
      if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'setups'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !positive(args.group_index, 10000) || !Array.isArray(args.setups) || args.setups.length < 2 || args.setups.length > 5 || args.setups.some(setup => !setup || typeof setup !== 'object' || Array.isArray(setup) || Object.keys(setup).some(key => !['name', 'gems'].includes(key)) || typeof setup.name !== 'string' || !setup.name.trim() || setup.name.length > 100 || !Array.isArray(setup.gems))) throw new Error('Invalid gem setup job options');
      const normalize = (value: string) => value.trim().toLowerCase().replace(/ support$/, '');
      if (new Set(args.setups.map(setup => setup.name.trim().toLowerCase())).size !== args.setups.length || args.setups.some(setup => setup.gems.length < 1 || setup.gems.length > 6 || setup.gems.some((gem: Record<string, unknown>) => !gem || typeof gem !== 'object' || Array.isArray(gem) || Object.keys(gem).some(key => !['gemName', 'level', 'quality', 'enabled'].includes(key)) || Object.values(gem).some(value => value === undefined) || typeof gem.gemName !== 'string' || !gem.gemName.trim() || gem.gemName.length > 200 || (gem.level !== undefined && !positive(gem.level, 40)) || (gem.quality !== undefined && (typeof gem.quality !== 'number' || !Number.isSafeInteger(gem.quality) || gem.quality < 0 || gem.quality > 99)) || (gem.enabled !== undefined && typeof gem.enabled !== 'boolean')) || new Set(setup.gems.map((gem: { gemName: string }) => normalize(gem.gemName))).size !== setup.gems.length)) throw new Error('Invalid gem setup job options');
      const parent = await foundation.inspect(args.snapshot_id, ['skills']);
      const skills = parent.data.skills as { mainSocketGroup?: unknown; groups?: Array<{ index?: number; enabled?: boolean; slotEnabled?: boolean; gems?: Array<{ name?: string; isSupport?: boolean; enabled?: boolean }> }> };
      const group = Array.isArray(skills?.groups) ? skills.groups.find(value => value.index === args.group_index) : undefined;
      const active = group?.gems?.filter(gem => gem.isSupport === false) ?? [];
      if (skills?.mainSocketGroup !== args.group_index || group?.enabled !== true || group?.slotEnabled !== true || active.length !== 1 || active[0].enabled !== true || typeof active[0].name !== 'string') throw new Error('Gem setup job requires one enabled active gem in the active main group');
      if (args.setups.some(setup => !setup.gems.some((gem: { gemName?: unknown; enabled?: unknown }) => gem && typeof gem.gemName === 'string' && normalize(gem.gemName) === normalize(active[0].name!) && gem.enabled !== false))) throw new Error('Every setup must retain the enabled active gem');
      const inputs: GemSetupEvaluationInput[] = args.setups.map(setup => ({ kind: 'gem_setup', snapshotId: args.snapshot_id as string, groupIndex: args.group_index as number, setupName: setup.name, gems: setup.gems, discoveryIdentity: parent.identity }));
      const job = await jobs.submitGemSetups(inputs);
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, status: job.status, snapshotId: args.snapshot_id, groupIndex: args.group_index, setupCount: inputs.length, activeGem: active[0].name, identity: parent.identity,
        warnings: [...parent.warnings, 'Poll foundation_get_job or summarize_snapshot_gem_setups; cancel with foundation_cancel_job.', 'Each candidate is an isolated seven-day trial; failures do not change the parent.'] }) }] };
    } },
    { schema: summary, invoke: async args => {
      if (Object.keys(args).some(key => key !== 'job_id') || typeof args.job_id !== 'string') throw new Error('Invalid gem setup job ID');
      const job = await jobs.get(args.job_id);
      if (!Array.isArray(job.items) || job.items.length < 2 || job.items.length > 5) throw new Error('Invalid gem setup job');
      const first = job.items[0].input as GemSetupEvaluationInput;
      if (!first || first.kind !== 'gem_setup') throw new Error('Job is not a gem setup comparison');
      if (typeof first.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(first.snapshotId) || !Number.isSafeInteger(first.groupIndex) || first.groupIndex < 1 || !first.discoveryIdentity || typeof first.discoveryIdentity !== 'object') throw new Error('Invalid gem setup job inputs');
      let baseline: any, mismatch = false;
      const identityUnknown = new Set<string>(), names = new Set<string>();
      for (const key of keys) if (!first.discoveryIdentity[key]) identityUnknown.add(key);
      const results: Array<Record<string, unknown> & { status: string }> = [];
      for (const item of job.items) {
        const input = item.input as GemSetupEvaluationInput;
        if (!input || input.kind !== 'gem_setup' || input.snapshotId !== first.snapshotId || input.groupIndex !== first.groupIndex || !isDeepStrictEqual(input.discoveryIdentity, first.discoveryIdentity) || typeof input.setupName !== 'string' || !input.setupName.trim() || names.has(input.setupName.trim().toLowerCase()) || !Array.isArray(input.gems)) throw new Error('Invalid gem setup job inputs');
        names.add(input.setupName.trim().toLowerCase());
        if (item.status !== 'completed') { results.push({ name: input.setupName, status: item.status, ...(item.error ? { reason: item.error } : {}) }); continue; }
        const report = item.result as any;
        if (report && typeof report.setupError === 'string' && typeof report.candidateSnapshotId === 'string' && /^[a-f0-9]{64}$/.test(report.candidateSnapshotId)) { results.push({ name: input.setupName, status: 'error', reason: report.setupError, snapshotId: report.candidateSnapshotId }); continue; }
        if (!report || report.snapshotId !== first.snapshotId || report.groupIndex !== first.groupIndex || !report.baseline || !report.baseline.identity || !Array.isArray(report.results) || report.results.length !== 1 || !report.results[0] || !['ok', 'error'].includes(report.results[0].status)) throw new Error('Invalid gem setup job result');
        for (const key of keys) {
          const initial = first.discoveryIdentity[key], actual = report.baseline.identity[key];
          if (!initial || !actual) identityUnknown.add(key); else if (initial !== actual) mismatch = true;
        }
        if (!baseline) baseline = report.baseline; else if (!isDeepStrictEqual(baseline, report.baseline)) mismatch = true;
        const entry = report.results[0];
        if (Array.isArray(entry.identityUnknown)) for (const key of entry.identityUnknown) if (typeof key === 'string') identityUnknown.add(key);
        results.push({ ...entry, name: input.setupName });
      }
      const safeResults = mismatch ? results.map(result => result.status === 'ok' ? { ...result, status: 'unranked', metrics: null, reason: 'Baseline or engine identity differs across observations' } : result) : results;
      const complete = job.status === 'completed' && !mismatch && safeResults.every(result => result.status === 'ok');
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, jobStatus: job.status, snapshotId: first.snapshotId, groupIndex: first.groupIndex, status: complete ? 'complete' : 'partial', baseline: baseline ?? null, baselineMismatch: mismatch, identityUnknown: [...identityUnknown], results: safeResults,
        warnings: ['This compares only the submitted setups; pending, failed or unrankable setups make the result partial.', 'Player, minion and full DPS are separate PoB outputs; do not add them blindly. Verify poison, chosen skill and configuration.', 'Gem availability, socket colours, requirements, price, mana cost and legality are not established.', 'Trial snapshots expire after seven days unless retained.', ...(identityUnknown.size ? ['Some engine identities are unknown; compatibility is unverified.'] : []), ...(mismatch ? ['Baseline or engine identity differed; numerical comparisons were withheld.'] : [])] }) }] };
    } },
  ];
}
