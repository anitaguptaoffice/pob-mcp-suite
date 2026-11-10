import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function timelessSearchSchema(): FeatureTool['schema'] {
  return { name: 'search_snapshot_timeless_seeds', description: 'Search Elegant Hubris seeds using the snapshot tree and PoB native lookup data. Results cover all notables in the socket radius, including unallocated nodes.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, socket_node_id: { type: 'integer', minimum: 1 }, desired_node_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string' } },
    seeds: { type: 'array', minItems: 1, maxItems: 8000, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    historic_figure: { type: 'string', enum: ['Caspiro'] }, keystone_node_id: { type: 'integer', minimum: 1 }, required_source_node_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
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
        !Number.isSafeInteger(result.scannedSeeds) || result.scannedSeeds < 1 || !Number.isSafeInteger(result.totalMatches) || result.totalMatches < 0 || !Array.isArray(result.results) || result.results.length > (params.limit ?? 20) || result.results.length > result.totalMatches) throw new Error('PoB returned invalid timeless search results');
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, jewelType: result.jewelType, treeVersion: result.treeVersion, socketNodeId: result.socketNodeId, scannedSeeds: result.scannedSeeds, totalMatches: result.totalMatches,
      returnedCount: result.results.length, results: result.results, seedScope: seeds === undefined ? 'all_valid_seeds' : 'explicit_seeds', desiredNodeIds: ids,
      warnings: [...response.warnings, 'Search covers all notable nodes in the radius, including unallocated nodes; each hit reports whether it is allocated.', 'Only Elegant Hubris and the Caspiro fixed keystone are supported. The search does not check market availability, price or build legality.', 'A fixed keystone is included in a score only when a seed-dependent requested notable also matches.'] }) }] };
  } };
}
