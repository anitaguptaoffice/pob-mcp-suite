import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function clusterAnalysisSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_cluster_jewels', description: 'Inspect cluster jewels socketed in the active snapshot tree and PoB-generated notable allocations; unavailable graphs remain unknown.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}
export function createClusterAnalysisTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: clusterAnalysisSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Valid snapshot ID is required');
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => engine.getClusterJewels());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('PoB returned invalid cluster data');
    const value = result as { treeVersion?: unknown; jewels?: unknown };
    if (typeof value.treeVersion !== 'string' || !value.treeVersion || !Array.isArray(value.jewels)) throw new Error('PoB returned invalid cluster data');
    const jewels = value.jewels as Array<Record<string, unknown>>;
    if (jewels.some(jewel => !jewel || !Number.isSafeInteger(jewel.socketNodeId) || (jewel.socketNodeId as number) < 1 || typeof jewel.graphAvailable !== 'boolean' || (jewel.socketAllocated !== undefined && typeof jewel.socketAllocated !== 'boolean') || (jewel.graphAvailable === true && (!Array.isArray(jewel.notables) || jewel.notables.some((node: any) => !node || !Number.isSafeInteger(node.id) || typeof node.name !== 'string' || !node.name || typeof node.allocated !== 'boolean'))) || (jewel.graphAvailable === false && jewel.notables !== undefined))) throw new Error('PoB returned invalid cluster jewel');
    const incomplete = jewels.filter(jewel => !jewel.graphAvailable).length;
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, treeVersion: value.treeVersion, jewels, graphUnavailableCount: incomplete,
      warnings: [...context.warnings, 'Socketed jewels and generated graphs reflect the active PoB tree, not all items stored in the build.', 'A missing graph or socket allocation is unknown; it does not prove that the jewel has no notables or that its effects apply.', 'Notable allocation is read from PoB; synergy, optimality, damage, legality and item availability require separate evaluation.'] }) }] };
  } };
}
