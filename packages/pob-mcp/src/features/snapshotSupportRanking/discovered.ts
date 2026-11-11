import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { createSnapshotSupportRankingTool } from './tool.js';

const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
type Foundation = Pick<BuildFoundation, 'compatibleSupports' | 'evaluate' | 'deriveSupportReplacement'>;

export function discoveredSupportRankingSchema(): FeatureTool['schema'] {
  return { name: 'rank_discovered_snapshot_supports', description: 'Discover a bounded alphabetical set of PoB-compatible supports and rank up to four explicit replacements by one metric; not a global optimizer.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gem_index: { type: 'integer', minimum: 1 }, metric: { type: 'string' }, direction: { type: 'string', enum: ['higher', 'lower'] },
    query: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 4 }, include_exceptional: { type: 'boolean' },
  }, required: ['snapshot_id', 'group_index', 'gem_index', 'metric'] } };
}

export function createDiscoveredSupportRankingTool(foundation: Foundation): FeatureTool {
  return { schema: discoveredSupportRankingSchema(), invoke: async args => {
    const integer = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;
    if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'gem_index', 'metric', 'direction', 'query', 'limit', 'include_exceptional'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !integer(args.group_index, 10000) || !integer(args.gem_index, 10000) || typeof args.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(args.metric) || (args.direction !== undefined && !['higher', 'lower'].includes(args.direction as string)) || (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 80)) || (args.limit !== undefined && !integer(args.limit, 4)) || (args.include_exceptional !== undefined && typeof args.include_exceptional !== 'boolean')) throw new Error('Invalid discovered support ranking options');
    const limit = (args.limit ?? 4) as number;
    const discovery = await foundation.compatibleSupports(args.snapshot_id, { groupIndex: args.group_index as number, query: args.query as string | undefined, limit: 100, includeExceptional: args.include_exceptional as boolean | undefined });
    if (discovery.groupIndex !== args.group_index || !discovery.identity || typeof discovery.identity !== 'object' || !Array.isArray(discovery.warnings) || !Array.isArray(discovery.candidates) || !Number.isSafeInteger(discovery.total) || discovery.total < discovery.candidates.length || !Number.isSafeInteger(discovery.failed) || discovery.failed < 0 || discovery.candidates.length > 100 || discovery.candidates.some(entry => !entry || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.id !== 'string' || !entry.id || typeof entry.alreadySocketed !== 'boolean' || typeof entry.exceptional !== 'boolean')) throw new Error('PoB returned invalid support discovery');
    const normalized = (name: string) => name.trim().toLowerCase().replace(/ support$/, '');
    const seen = new Set<string>();
    const eligible = discovery.candidates.filter(candidate => {
      const key = normalized(candidate.name);
      if (candidate.alreadySocketed || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const selected = eligible.slice(0, limit);
    const context = { snapshotId: args.snapshot_id, groupIndex: args.group_index, discovery: { total: discovery.total, failed: discovery.failed, returned: discovery.candidates.length, eligibleReturned: eligible.length, selected, identity: discovery.identity, warnings: discovery.warnings } };
    const warnings = ['Candidates are chosen from bounded alphabetical PoB discovery, not exhaustive or optimized; search with a different query or compare explicit candidates.', 'Compatibility alone does not establish a damage increase, in-game availability, socket legality or price.'];
    if (!selected.length) return { content: [{ type: 'text', text: JSON.stringify({ ...context, status: 'no_candidates', rankedCandidates: [], results: [], warnings }) }] };
    const response = await createSnapshotSupportRankingTool(foundation).invoke({ snapshot_id: args.snapshot_id, group_index: args.group_index, gem_index: args.gem_index, metric: args.metric, ...(args.direction === undefined ? {} : { direction: args.direction }), candidates: selected.map(candidate => ({ gem_name: candidate.name })) });
    const ranking = JSON.parse(response.content[0].text);
    const mismatched = identityKeys.filter(key => discovery.identity[key] && ranking.baseline.identity[key] && discovery.identity[key] !== ranking.baseline.identity[key]);
    const unknown = identityKeys.filter(key => !discovery.identity[key] || !ranking.baseline.identity[key] || discovery.warnings.some(warning => warning.startsWith(`${key} is unknown;`)) || ranking.baseline.warnings.some((warning: string) => warning.startsWith(`${key} is unknown;`)));
    if (mismatched.length) {
      ranking.rankedCandidates = [];
      ranking.results = ranking.results.map((entry: Record<string, unknown>) => entry.status === 'ok' ? { ...entry, status: 'unranked', delta: null, percent: null, reason: `Discovery and evaluation identities differ: ${mismatched.join(', ')}` } : entry);
    }
    const status = mismatched.length ? 'identity_mismatch' : discovery.failed || ranking.results.some((entry: { status: string }) => entry.status !== 'ok') ? 'partial' : 'evaluated';
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, status, identityUnknown: unknown, ranking, warnings: [...warnings, ...(unknown.length ? ['Some discovery or baseline identities are unknown; compatibility is unverified.'] : []), ...(mismatched.length ? ['Discovery and evaluation identities differ; ranking withheld.'] : [])] }) }] };
  } };
}
