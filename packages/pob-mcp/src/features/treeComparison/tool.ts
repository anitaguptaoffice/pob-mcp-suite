import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function snapshotTreeComparisonSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_trees', description: 'Compare allocated passive nodes and mastery selections on two immutable snapshots with the same known tree version; this does not calculate damage or establish legality.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { baseline_snapshot_id: { type: 'string' }, candidate_snapshot_id: { type: 'string' } }, required: ['baseline_snapshot_id', 'candidate_snapshot_id'] } };
}

type Tree = { treeVersion: string; nodes: number[]; masteryEffects: Record<string, number>; classId?: number; ascendClassId?: number; secondaryAscendClassId?: number; className?: string; ascendClassName?: string; secondaryAscendClassName?: string };
function readTree(value: unknown): Tree {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PoB returned an invalid tree');
  const tree = value as Tree;
  if (typeof tree.treeVersion !== 'string' || !tree.treeVersion.trim()) throw new Error('Cannot compare trees without a known tree version');
  if (!Array.isArray(tree.nodes) || tree.nodes.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(tree.nodes).size !== tree.nodes.length) throw new Error('PoB returned invalid tree nodes');
  const mastery = tree.masteryEffects;
  if (!mastery || typeof mastery !== 'object' || (Array.isArray(mastery) && mastery.length !== 0) || Object.entries(mastery).some(([id, effect]) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !Number.isSafeInteger(effect) || effect < 1)) throw new Error('PoB returned invalid mastery selections');
  return tree;
}

export function createSnapshotTreeComparisonTool(foundation: Pick<BuildFoundation, 'inspect'>): FeatureTool {
  return { schema: snapshotTreeComparisonSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['baseline_snapshot_id', 'candidate_snapshot_id'].includes(key)) || typeof args.baseline_snapshot_id !== 'string' || !args.baseline_snapshot_id.trim() || typeof args.candidate_snapshot_id !== 'string' || !args.candidate_snapshot_id.trim()) throw new Error('Two explicit snapshot IDs are required');
    const baseline = await foundation.inspect(args.baseline_snapshot_id, ['tree']);
    const candidate = await foundation.inspect(args.candidate_snapshot_id, ['tree']);
    const left = readTree(baseline.data.tree);
    const right = readTree(candidate.data.tree);
    if (left.treeVersion !== right.treeVersion) throw new Error(`Cannot compare incompatible tree versions: ${left.treeVersion} and ${right.treeVersion}`);
    for (const key of ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const) {
      if (baseline.identity[key] && candidate.identity[key] && baseline.identity[key] !== candidate.identity[key]) throw new Error(`Cannot compare observations from different ${key}`);
    }
    const leftIds = new Set(left.nodes), rightIds = new Set(right.nodes);
    const nodesAdded = right.nodes.filter(id => !leftIds.has(id)).sort((a, b) => a - b);
    const nodesRemoved = left.nodes.filter(id => !rightIds.has(id)).sort((a, b) => a - b);
    const masteryIds = [...new Set([...Object.keys(left.masteryEffects), ...Object.keys(right.masteryEffects)])].sort((a, b) => Number(a) - Number(b));
    const masteryChanges = masteryIds.flatMap(nodeId => {
      const before = left.masteryEffects[nodeId] ?? null, after = right.masteryEffects[nodeId] ?? null;
      return before === after ? [] : [{ nodeId: Number(nodeId), before, after }];
    });
    const character = (tree: Tree) => ({ classId: tree.classId ?? null, className: tree.className ?? null, ascendClassId: tree.ascendClassId ?? null, ascendClassName: tree.ascendClassName ?? null, secondaryAscendClassId: tree.secondaryAscendClassId ?? null, secondaryAscendClassName: tree.secondaryAscendClassName ?? null });
    return { content: [{ type: 'text', text: JSON.stringify({ baselineSnapshotId: baseline.snapshotId, candidateSnapshotId: candidate.snapshotId, treeVersion: left.treeVersion,
      baseline: { nodeCount: left.nodes.length, character: character(left), identity: baseline.identity, warnings: baseline.warnings },
      candidate: { nodeCount: right.nodes.length, character: character(right), identity: candidate.identity, warnings: candidate.warnings },
      nodesAdded, nodesRemoved, masteryChanges, warnings: ['Node IDs are compared within the stated tree version; this does not calculate stats, point cost or legality.'] }) }] };
  } };
}
