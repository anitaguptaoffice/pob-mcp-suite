import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function timelessSearchSchema(): FeatureTool['schema'] {
  return { name: 'search_snapshot_timeless_seeds', description: 'Search Elegant Hubris seeds using the snapshot tree and PoB native lookup data. Results cover all notables in the socket radius, including unallocated nodes.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, socket_node_id: { type: 'integer', minimum: 1 }, desired_node_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string' } },
    seeds: { type: 'array', minItems: 1, maxItems: 8000, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    historic_figure: { type: 'string', enum: ['Caspiro'] }, keystone_node_id: { type: 'integer', minimum: 1 }, required_source_node_ids: { type: 'array', description: 'If nonempty, at least one seed-dependent hit must occur on one of these original notable nodes; this is an any-of filter.', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
  }, required: ['snapshot_id', 'socket_node_id', 'desired_node_ids'] } };
}

export function createTimelessSearchTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: timelessSearchSchema(), invoke: async args => {
    const keys = ['snapshot_id', 'socket_node_id', 'desired_node_ids', 'seeds', 'limit', 'historic_figure', 'keystone_node_id', 'required_source_node_ids'];
    const validId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
    const ids = args.desired_node_ids, seeds = args.seeds, required = args.required_source_node_ids;
    if (Object.keys(args).some(key => !keys.includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !validId(args.socket_node_id) ||
        !Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 200) || new Set(ids).size !== ids.length ||
        (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) ||
        (seeds !== undefined && (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 8000 || seeds.some(seed => !validId(seed) || seed % 20 !== 0) || new Set(seeds).size !== seeds.length)) ||
        (required !== undefined && (!Array.isArray(required) || required.length > 100 || required.some(id => !validId(id)) || new Set(required).size !== required.length)) ||
        (args.historic_figure !== undefined && args.historic_figure !== 'Caspiro') || ((args.historic_figure === undefined) !== (args.keystone_node_id === undefined)) || (args.keystone_node_id !== undefined && !validId(args.keystone_node_id))) throw new Error('Invalid timeless search options');
    const params = { socketNodeId: args.socket_node_id as number, desired: ids as string[], ...(seeds === undefined ? {} : { seeds: seeds as number[] }),
      ...(args.limit === undefined ? {} : { limit: args.limit as number }), ...(args.historic_figure === undefined ? {} : { historicFigure: args.historic_figure as string, keystoneNodeId: args.keystone_node_id as number }),
      ...(required === undefined ? {} : { requiredSourceNodeIds: required as number[] }) };
    const response = await foundation.runReadOnlySnapshot(args.snapshot_id, engine => engine.findTimelessJewelSeedsDetailed(params));
    const { result, ...context } = response;
    if (!result || result.socketNodeId !== params.socketNodeId || typeof result.treeVersion !== 'string' || !result.treeVersion || result.jewelType !== 'Elegant Hubris' ||
        !Number.isSafeInteger(result.scannedSeeds) || result.scannedSeeds < 1 || (params.seeds && result.scannedSeeds !== params.seeds.length) || !Number.isSafeInteger(result.totalMatches) || result.totalMatches < 0 || result.totalMatches > result.scannedSeeds || !Array.isArray(result.results) || result.results.length !== Math.min(result.totalMatches, params.limit ?? 20)) throw new Error('PoB returned invalid timeless search results');
    const seenSeeds = new Set<number>();
    for (let i = 0; i < result.results.length; i++) {
      const candidate = result.results[i] as Record<string, unknown>;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !validId(candidate.seed) || (candidate.seed as number) % 20 !== 0 || (params.seeds && !params.seeds.includes(candidate.seed as number)) || seenSeeds.has(candidate.seed as number) || !Number.isSafeInteger(candidate.score) || !Array.isArray(candidate.hits) || candidate.score !== candidate.hits.length || candidate.hits.length === 0) throw new Error('PoB returned invalid timeless candidate');
      seenSeeds.add(candidate.seed as number);
      const seenNodes = new Set<number>();
      let dynamicHits = 0, requiredHit = false;
      for (const hit of candidate.hits) {
        if (!hit || typeof hit !== 'object' || Array.isArray(hit) || !validId(hit.nodeId) || seenNodes.has(hit.nodeId) || typeof hit.id !== 'string' || !params.desired.includes(hit.id) || typeof hit.allocated !== 'boolean' || !Array.isArray(hit.stats) || hit.stats.some((line: unknown) => typeof line !== 'string') || (hit.static !== undefined && hit.static !== true)) throw new Error('PoB returned invalid timeless hit');
        seenNodes.add(hit.nodeId);
        if (hit.static === true) {
          if (params.historicFigure !== 'Caspiro' || params.keystoneNodeId !== hit.nodeId || hit.id !== 'eternal_keystone_3_v2') throw new Error('PoB returned invalid timeless keystone');
        } else {
          dynamicHits++;
          if (params.requiredSourceNodeIds?.includes(hit.nodeId)) requiredHit = true;
        }
      }
      if (!dynamicHits || (params.requiredSourceNodeIds?.length && !requiredHit)) throw new Error('PoB returned unmatched timeless candidate');
      if (i > 0) {
        const prior = result.results[i - 1] as { score: number; seed: number };
        if (prior.score < (candidate.score as number) || (prior.score === candidate.score && prior.seed > (candidate.seed as number))) throw new Error('PoB returned unsorted timeless candidates');
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, jewelType: result.jewelType, treeVersion: result.treeVersion, socketNodeId: result.socketNodeId, scannedSeeds: result.scannedSeeds, totalMatches: result.totalMatches,
      returnedCount: result.results.length, results: result.results, seedScope: seeds === undefined ? 'all_valid_seeds' : 'explicit_seeds', desiredNodeIds: ids,
      warnings: [...response.warnings, 'Search covers all notable nodes in the radius, including unallocated nodes; each hit reports whether it is allocated.', 'Only Elegant Hubris and the Caspiro fixed keystone are supported. The search does not check market availability, price or build legality.', 'A fixed keystone is included in a score only when a seed-dependent requested notable also matches.', 'A nonempty required_source_node_ids filter requires at least one matching source node, not all of them.'] }) }] };
  } };
}
