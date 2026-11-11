import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { isDeepStrictEqual } from 'node:util';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { compareSnapshotGemSetups } from './tool.js';

type Foundation = Pick<BuildFoundation, 'inspect' | 'evaluate' | 'readSnapshot' | 'deriveGem'>;

export function supportContributionsSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_support_contributions', description: 'Measure explicitly selected applied supports by disabling each in an isolated trial and comparing PoB damage against the unchanged snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gem_indices: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'integer', minimum: 1 } } }, required: ['snapshot_id', 'group_index', 'gem_indices'] } };
}

export function createSupportContributionsTool(foundation: Foundation): FeatureTool {
  return { schema: supportContributionsSchema(), invoke: async args => {
    const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 10000;
    const indices = args.gem_indices;
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'gem_indices'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !positive(args.group_index) || !Array.isArray(indices) || indices.length < 1 || indices.length > 3 || indices.some(index => !positive(index)) || new Set(indices).size !== indices.length) throw new Error('Invalid support contribution options');
    const parent = args.snapshot_id, groupIndex = args.group_index;
    const inspected = await foundation.inspect(parent, ['skills']);
    const skills = inspected.data.skills as { mainSocketGroup?: unknown; groups?: Array<{ index?: unknown; enabled?: unknown; slotEnabled?: unknown; gems?: Array<{ index?: unknown; name?: unknown; enabled?: unknown; isSupport?: unknown; appliedToSelectedSkill?: unknown }> }> } | undefined;
    const groups = skills?.groups?.filter(group => group.index === groupIndex) ?? [];
    const group = groups.length === 1 ? groups[0] : undefined;
    if (skills?.mainSocketGroup !== groupIndex || !group || group.enabled !== true || group.slotEnabled !== true || !Array.isArray(group.gems)) throw new Error('Requested group is not the enabled saved main skill group');
    const results: Array<Record<string, unknown>> = [];
    for (const index of indices as number[]) {
      const matches = group.gems.filter(gem => gem.index === index), gem = matches.length === 1 ? matches[0] : undefined;
      if (!gem || gem.enabled !== true || gem.isSupport !== true || gem.appliedToSelectedSkill !== true) {
        results.push({ gemIndex: index, gemName: gem?.name ?? null, status: 'unavailable', reason: 'Enabled support application to the selected skill was not confirmed' });
        continue;
      }
      let snapshotId: string | undefined;
      try {
        const trial = await foundation.deriveGem(parent, groupIndex, index, { enabled: false }, true);
        snapshotId = trial.id;
        if (trial.parentId !== parent) throw new Error('Trial snapshot parent mismatch');
        const comparison = await compareSnapshotGemSetups(foundation, { snapshot_id: parent, group_index: groupIndex, candidate_snapshot_ids: [trial.id] });
        if (!isDeepStrictEqual(inspected.data.skills, comparison.baseline.context.skills)) throw new Error('Baseline skills changed since support discovery');
        for (const key of ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const) if (inspected.identity[key] && comparison.baseline.identity[key] && inspected.identity[key] !== comparison.baseline.identity[key]) throw new Error(`PoB identity changed since support discovery: ${key}`);
        results.push({ gemIndex: index, gemName: gem.name ?? null, status: comparison.results[0].status, snapshotId, baseline: comparison.baseline, comparison: comparison.results[0], warnings: comparison.warnings });
      } catch (error) {
        results.push({ gemIndex: index, gemName: gem.name ?? null, status: 'error', ...(snapshotId ? { snapshotId } : {}), reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: parent, groupIndex, discovery: { identity: inspected.identity, warnings: inspected.warnings }, results, warnings: ['Each delta is the damage change after disabling that support alone, not its gain when added. Effects interact and must not be summed.', 'Values describe the saved PoB scenario. Check metric availability, identity warnings, selected skill, ailments and uptime; gem legality and global optimality are not established.', 'Trials expire after seven days unless retained. Failures or unknown support application are not zero contribution.'] }) }] };
  } };
}
