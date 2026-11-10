import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const snapshot = { type: 'string' };
export function treePathSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'find_snapshot_tree_path', description: 'Query the PoB native path to one passive node on the snapshot tree.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: snapshot, target_node_id: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'target_node_id'] } },
    { name: 'find_snapshot_nearby_nodes', description: 'Find unallocated reachable notables and keystones by PoB native passive-point distance on the snapshot tree.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: snapshot, max_distance: { type: 'integer', minimum: 1, maximum: 100 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, filter: { type: 'string', maxLength: 200 } }, required: ['snapshot_id'] } },
  ];
}

export function createTreePathTools(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool[] {
  return treePathSchemas().map(schema => ({ schema, invoke: async args => {
    const target = schema.name === 'find_snapshot_tree_path';
    const keys = target ? ['snapshot_id', 'target_node_id'] : ['snapshot_id', 'max_distance', 'limit', 'filter'];
    const validInt = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
    if (Object.keys(args).some(key => !keys.includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) ||
        (target && !validInt(args.target_node_id, 2147483647)) || (!target && ((args.max_distance !== undefined && !validInt(args.max_distance, 100)) || (args.limit !== undefined && !validInt(args.limit, 100)) || (args.filter !== undefined && (typeof args.filter !== 'string' || args.filter.length > 200))))) throw new Error('Invalid tree path options');
    const params = target ? { targetNodeId: args.target_node_id as number } : { maxDistance: (args.max_distance ?? 3) as number, limit: (args.limit ?? 30) as number, filter: (args.filter ?? '') as string };
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, engine => engine.queryTreePaths(params));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('PoB returned invalid path results');
    const value = result as Record<string, unknown>;
    if (typeof value.treeVersion !== 'string' || !value.treeVersion || value.mode !== (target ? 'target' : 'nearby')) throw new Error('PoB returned invalid path results');
    const validNode = (item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const node = item as Record<string, unknown>, path = node.pathNodes;
      if (!validInt(node.id, 2147483647) || typeof node.allocated !== 'boolean' || typeof node.isBlighted !== 'boolean' || !Array.isArray(path) || path.some(n => !validInt(n, 2147483647)) || new Set(path).size !== path.length || !Array.isArray(node.stats) || node.stats.some(s => typeof s !== 'string')) return false;
      if (node.status === 'allocated') return node.allocated && node.pointCost === 0 && path.length === 0;
      if (node.status === 'unreachable') return !node.allocated && node.pointCost == null && path.length === 0;
      return node.status === 'reachable' && !node.allocated && path.length > 0 && path[path.length - 1] === node.id && node.pointCost === path.length;
    };
    if (target) {
      if (value.targetNodeId !== params.targetNodeId || !['found', 'not_found'].includes(value.status as string) || (value.status === 'found' ? !validNode(value.node) || (value.node as { id: number }).id !== params.targetNodeId : value.node != null)) throw new Error('PoB returned invalid target path');
    } else {
      const nodes = value.nodes;
      if (value.maxDistance !== params.maxDistance || !Array.isArray(nodes) || !Number.isSafeInteger(value.total) || (value.total as number) < nodes.length || nodes.length > (params.limit as number) || nodes.some(node => !validNode(node) || node.status !== 'reachable' || !['notable', 'keystone'].includes(node.type) || node.pointCost > (params.maxDistance as number))) throw new Error('PoB returned invalid nearby paths');
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, ...value, warnings: [...context.warnings, 'Paths are PoB native suggestions for this snapshot, not a guarantee of point availability or build legality. Allocate and verify a derived snapshot before relying on the change.', 'Blighted nodes and mastery choices may need special handling; paths do not select mastery effects.'] }) }] };
  } }));
}
