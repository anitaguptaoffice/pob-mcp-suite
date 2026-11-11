import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { OfficialTreeCode } from '../../ports/officialTreeCode.js';

export function officialTreeSchema(): FeatureTool['schema'] {
  return { name: 'derive_snapshot_official_tree', description: 'Decode an official PoE 1 passive tree URL or code in binary formats 1–6 and replace the active tree of a snapshot. Requires an explicit PoB tree version and verifies every encoded node; defaults to a seven-day trial.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, code: { type: 'string' }, tree_version: { type: 'string' }, trial: { type: 'boolean' } }, required: ['snapshot_id', 'code', 'tree_version'] } };
}

export function createOfficialTreeTool(foundation: Pick<BuildFoundation, 'resolveTreeStartingNodes' | 'deriveTreeReplacement'>, decode: (input: string) => OfficialTreeCode): FeatureTool {
  return { schema: officialTreeSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'code', 'tree_version', 'trial'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.code !== 'string' || typeof args.tree_version !== 'string' || !/^\d+_\d+[A-Za-z0-9_]*$/.test(args.tree_version) || args.tree_version.length > 60 || (args.trial !== undefined && typeof args.trial !== 'boolean')) throw new Error('Invalid official tree import options');
    const decoded = decode(args.code), version = args.tree_version;
    const base = { classId: decoded.classId, ascendClassId: decoded.ascendClassId, secondaryAscendClassId: decoded.secondaryAscendClassId, treeVersion: version };
    const observed = await foundation.resolveTreeStartingNodes(args.snapshot_id, base);
    const tree = { ...base, nodes: [...new Set([...observed.nodes, ...decoded.nodes])], masteryEffects: decoded.masteryEffects };
    const child = await foundation.deriveTreeReplacement(args.snapshot_id, tree, args.trial !== false, 'reject');
    return { content: [{ type: 'text', text: JSON.stringify({ snapshot: snapshotMetadata(child), decoded, requestedTreeVersion: version, startingNodes: observed.nodes, identity: observed.identity, warnings: [...observed.warnings, 'The official code does not contain a PoB tree version; verify the supplied version against the source.', 'Node overrides, jewel assignments, items and skills are not encoded by the official tree link. Existing target overrides are rejected; socketed jewels can affect cluster nodes.', 'PoB confirmed the encoded tree and serialization, not point availability, connectivity or in-game legality. The parent remains unchanged; trials expire after seven days unless retained.'] }) }] };
  } };
}
