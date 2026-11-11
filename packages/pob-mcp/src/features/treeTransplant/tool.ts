import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function snapshotTreeTransplantSchema(): FeatureTool['schema'] {
  return { name: 'transplant_snapshot_tree', description: 'Copy the active tree from one snapshot into a verified child of another. Defaults to a seven-day trial. Rejects node overrides and does not save a file or establish legality.', inputSchema: { type: 'object', additionalProperties: false, properties: { source_snapshot_id: { type: 'string' }, target_snapshot_id: { type: 'string' }, trial: { type: 'boolean' } }, required: ['source_snapshot_id', 'target_snapshot_id'] } };
}

export function createSnapshotTreeTransplantTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveTreeReplacement'>): FeatureTool {
  return { schema: snapshotTreeTransplantSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['source_snapshot_id', 'target_snapshot_id', 'trial'].includes(key)) || typeof args.source_snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.source_snapshot_id) || typeof args.target_snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.target_snapshot_id) || (args.trial !== undefined && typeof args.trial !== 'boolean')) throw new Error('Invalid tree transplant options');
    const sourceId = args.source_snapshot_id, targetId = args.target_snapshot_id;
    const observed = await foundation.runReadOnlySnapshot(sourceId, async engine => {
      if (!engine.getTreeOverrides) throw new Error('PoB adapter lacks node override inspection');
      return { tree: await engine.getTree(), overrides: await engine.getTreeOverrides() };
    });
    const { tree, overrides } = observed.result;
    if (!Array.isArray(overrides)) throw new Error('PoB returned invalid node overrides');
    if (overrides.length) throw new Error('Source tree has node overrides; copying them is unsupported');
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) throw new Error('PoB returned invalid source tree');
    const value = tree as { classId?: unknown; ascendClassId?: unknown; secondaryAscendClassId?: unknown; treeVersion?: unknown; nodes?: unknown; masteryEffects?: unknown };
    const mastery = Array.isArray(value.masteryEffects) && value.masteryEffects.length === 0 ? {} : value.masteryEffects;
    const complete = { classId: value.classId, ascendClassId: value.ascendClassId, secondaryAscendClassId: value.secondaryAscendClassId, treeVersion: value.treeVersion, nodes: value.nodes, masteryEffects: mastery } as Parameters<BuildFoundation['deriveTreeReplacement']>[1];
    const child = await foundation.deriveTreeReplacement(targetId, complete, args.trial !== false, 'reject');
    return { content: [{ type: 'text', text: JSON.stringify({ sourceSnapshotId: sourceId, targetSnapshotId: targetId, sourceIdentity: observed.identity, snapshot: snapshotMetadata(child), warnings: [...observed.warnings, 'Only active tree nodes, class and mastery selections are copied. Node overrides, jewel assignments and other source build data are not copied.', 'Equipment, skills, configuration and inactive specs of the target are checked by PoB; other serialized metadata is not fully compared.', 'The new snapshot does not write a build file. Verify it before explicitly saving or restoring a file; point availability and legality remain unverified.'] }) }] };
  } };
}
