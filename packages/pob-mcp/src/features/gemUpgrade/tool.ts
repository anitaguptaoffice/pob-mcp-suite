import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { compareSnapshotGemSetups } from '../snapshotGemComparison/tool.js';

type Candidate = { gem_index: number; level?: number; quality?: number };
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
export function gemUpgradeSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_gem_upgrades', description: 'Compare 1–3 explicit gem level or quality changes in separate seven-day trial snapshots using saved PoB calculation context. Prices, gem availability and legality are not verified.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, candidates: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { gem_index: { type: 'integer', minimum: 1 }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 } }, required: ['gem_index'], anyOf: [{ required: ['level'] }, { required: ['quality'] }] } } }, required: ['snapshot_id', 'group_index', 'candidates'] } };
}

export function createGemUpgradeTool(foundation: Pick<BuildFoundation, 'deriveGem' | 'readSnapshot' | 'inspect' | 'evaluate'>): FeatureTool {
  return { schema: gemUpgradeSchema(), invoke: async args => {
    const validCandidate = (value: unknown): value is Candidate => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const item = value as Record<string, unknown>;
      return Object.keys(item).every(key => ['gem_index', 'level', 'quality'].includes(key)) && integer(item.gem_index, 1, 10000) && (item.level !== undefined || item.quality !== undefined) && (item.level === undefined || integer(item.level, 1, 40)) && (item.quality === undefined || integer(item.quality, 0, 99));
    };
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'candidates'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !integer(args.group_index, 1, 10000) || !Array.isArray(args.candidates) || args.candidates.length < 1 || args.candidates.length > 3 || args.candidates.some(item => !validCandidate(item))) throw new Error('Invalid gem upgrade options');
    const candidates = args.candidates as Candidate[];
    const keys = candidates.map(item => JSON.stringify([item.gem_index, item.level ?? null, item.quality ?? null]));
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate gem upgrade candidates');
    const snapshotId = args.snapshot_id, groupIndex = args.group_index as number;
    const results: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      let candidateId: string | undefined;
      try {
        const changes = { ...(candidate.level === undefined ? {} : { level: candidate.level }), ...(candidate.quality === undefined ? {} : { quality: candidate.quality }) };
        const derived = await foundation.deriveGem(snapshotId, groupIndex, candidate.gem_index, changes, true);
        candidateId = derived.id;
        if (derived.parentId !== snapshotId) throw new Error('Candidate snapshot parent mismatch');
        const report = await compareSnapshotGemSetups(foundation, { snapshot_id: snapshotId, group_index: groupIndex, candidate_snapshot_ids: [derived.id] });
        results.push({ candidate, snapshotId: derived.id, baseline: report.baseline, comparison: report.results[0] });
      } catch (error) {
        results.push({ candidate, ...(candidateId ? { snapshotId: candidateId } : {}), comparison: { status: 'error', error: error instanceof Error ? error.message : String(error) } });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, groupIndex, results, warnings: ['Each candidate changes one gem in a separate trial; candidates are not combined and are not ranked by cost or gain.', 'Comparison requires one enabled active gem in the saved main group. Player, minion and full damage are separate metrics; select the appropriate result and configuration.', 'Level, quality, item and socket legality, current prices, corruption and uptime are not verified. Trial snapshots expire after seven days unless retained; errors can still leave a reported trial snapshot.'] }) }] };
  } };
}
