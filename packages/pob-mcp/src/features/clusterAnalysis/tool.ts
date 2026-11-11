import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { CLUSTER_NOTABLE_TAGS, inferClusterArchetype } from '../../domain/clusterHeuristics.js';

export function clusterAnalysisSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_cluster_jewels', description: 'Inspect cluster jewels socketed in the active snapshot tree and PoB-generated notable allocations; optionally include unverified legacy keyword heuristics.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, include_legacy_heuristic: { type: 'boolean' } }, required: ['snapshot_id'] } };
}
export function createClusterAnalysisTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: clusterAnalysisSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'include_legacy_heuristic'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || (args.include_legacy_heuristic !== undefined && typeof args.include_legacy_heuristic !== 'boolean')) throw new Error('Valid snapshot ID and options are required');
    const includeHeuristic = args.include_legacy_heuristic === true;
    const { result: observed, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => includeHeuristic ? { cluster: await engine.getClusterJewels(), skills: await engine.getSkills() } : engine.getClusterJewels());
    const result = includeHeuristic ? (observed as { cluster?: unknown })?.cluster : observed;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('PoB returned invalid cluster data');
    const value = result as { treeVersion?: unknown; jewels?: unknown };
    if (typeof value.treeVersion !== 'string' || !value.treeVersion || !Array.isArray(value.jewels)) throw new Error('PoB returned invalid cluster data');
    const jewels = value.jewels as Array<Record<string, unknown>>;
    if (jewels.some(jewel => !jewel || !Number.isSafeInteger(jewel.socketNodeId) || (jewel.socketNodeId as number) < 1 || typeof jewel.graphAvailable !== 'boolean' || (jewel.socketAllocated !== undefined && typeof jewel.socketAllocated !== 'boolean') || (jewel.graphAvailable === true && (!Array.isArray(jewel.notables) || jewel.notables.some((node: any) => !node || !Number.isSafeInteger(node.id) || typeof node.name !== 'string' || !node.name || typeof node.allocated !== 'boolean'))) || (jewel.graphAvailable === false && jewel.notables !== undefined))) throw new Error('PoB returned invalid cluster jewel');
    const incomplete = jewels.filter(jewel => !jewel.graphAvailable).length;
    let legacyHeuristic: Record<string, unknown> | undefined;
    if (includeHeuristic) {
      const skills = (observed as { skills?: { groups?: unknown } }).skills;
      if (!skills || !Array.isArray(skills.groups) || skills.groups.some((group: any) => !group || !Array.isArray(group.gems) || group.gems.some((gem: any) => !gem || typeof gem.name !== 'string'))) throw new Error('PoB returned invalid skill groups for legacy heuristic');
      const gems = skills.groups.flatMap((group: any) => group.gems.map((gem: any) => ({ name: gem.name, groupIndex: group.index ?? null, gemIndex: gem.index ?? null, groupEnabled: typeof group.enabled === 'boolean' ? group.enabled : null, slotEnabled: typeof group.slotEnabled === 'boolean' ? group.slotEnabled : null, enabled: typeof gem.enabled === 'boolean' ? gem.enabled : null })));
      const tags = inferClusterArchetype(gems.map((gem: { name: string }) => gem.name));
      const matches = jewels.map(jewel => ({ socketNodeId: jewel.socketNodeId, rawAvailable: typeof jewel.raw === 'string' && !!jewel.raw.trim(), notables: typeof jewel.raw !== 'string' ? [] : Object.entries(CLUSTER_NOTABLE_TAGS).filter(([name]) => (jewel.raw as string).includes(name)).map(([name, notableTags]) => {
        const nodes = Array.isArray(jewel.notables) ? jewel.notables.filter((node: any) => node.name === name) : [];
        return { name, tags: notableTags, matchesArchetype: notableTags.some(tag => tags.includes(tag)), allocation: nodes.length === 1 ? nodes[0].allocated : null };
      }) }));
      legacyHeuristic = { status: 'unverified', archetypeTags: tags, gemInputs: gems, jewels: matches };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, treeVersion: value.treeVersion, jewels, graphUnavailableCount: incomplete,
      ...(legacyHeuristic ? { legacyHeuristic } : {}),
      warnings: [...context.warnings, 'Socketed jewels and generated graphs reflect the active PoB tree, not all items stored in the build.', 'A missing graph or socket allocation is unknown; it does not prove that the jewel has no notables or that its effects apply.', 'Notable allocation is read from PoB; synergy, optimality, damage, legality and item availability require separate evaluation.', ...(includeHeuristic ? ['Legacy keywords are unversioned and include disabled and inactive gems. Raw text substring matches may be wrong; an unmatched or unavailable notable is not evidence of poor synergy. Compare PoB calculations and check current data.'] : [])] }) }] };
  } };
}
