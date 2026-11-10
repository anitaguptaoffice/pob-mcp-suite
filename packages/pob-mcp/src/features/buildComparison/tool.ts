import { isDeepStrictEqual } from 'node:util';
import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const defaultFields = ['Life', 'EnergyShield', 'TotalEHP', 'Mana', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'CritChance', 'CritMultiplier', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'];
const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;

export function snapshotBuildComparisonSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_builds', description: 'Calculate and compare explicit snapshot metrics in their saved contexts. Different configurations, tree versions and unknown identities are reported; numeric differences do not establish build quality.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { baseline_snapshot_id: { type: 'string' }, candidate_snapshot_id: { type: 'string' }, fields: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } } }, required: ['baseline_snapshot_id', 'candidate_snapshot_id'],
  } };
}

export function createSnapshotBuildComparisonTool(foundation: Pick<BuildFoundation, 'evaluate' | 'inspect'>): FeatureTool {
  return { schema: snapshotBuildComparisonSchema(), invoke: async args => {
    const keys = ['baseline_snapshot_id', 'candidate_snapshot_id', 'fields'];
    const id = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const fields = args.fields === undefined ? defaultFields : args.fields;
    if (Object.keys(args).some(key => !keys.includes(key)) || !id(args.baseline_snapshot_id) || !id(args.candidate_snapshot_id) || !Array.isArray(fields) || fields.length < 1 || fields.length > 100 || fields.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim() || x.length > 100) || new Set(fields).size !== fields.length) throw new Error('Invalid snapshot comparison options');
    const baselineId = args.baseline_snapshot_id as string, candidateId = args.candidate_snapshot_id as string;
    const left = await foundation.evaluate(baselineId, fields as string[]);
    const leftTree = await foundation.inspect(baselineId, ['tree']);
    const right = await foundation.evaluate(candidateId, fields as string[]);
    const rightTree = await foundation.inspect(candidateId, ['tree']);
    const versions = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const version = (value as { treeVersion?: unknown }).treeVersion;
      return typeof version === 'string' && version.trim() ? version : null;
    };
    const baselineTreeVersion = versions(leftTree.data.tree), candidateTreeVersion = versions(rightTree.data.tree);
    const observations = [left, leftTree, right, rightTree];
    const identityDifferences = identityKeys.filter(key => new Set(observations.map(o => o.identity[key]).filter(Boolean)).size > 1);
    const identityUnknown = identityKeys.filter(key => observations.some(o => !o.identity[key] || o.warnings.some(warning => warning.startsWith(`${key} is unknown;`))));
    const configDifferent = !isDeepStrictEqual(left.context.config, right.context.config);
    const treeVersionStatus = !baselineTreeVersion || !candidateTreeVersion ? 'unknown' : baselineTreeVersion === candidateTreeVersion ? 'same' : 'different';
    const metrics = Object.fromEntries((fields as string[]).map(field => {
      const before = left.metrics[field], after = right.metrics[field];
      if (!before || !after || before.status !== 'available' || after.status !== 'available' || typeof before.value !== 'number' || typeof after.value !== 'number' || !Number.isFinite(before.value) || !Number.isFinite(after.value)) return [field, { status: 'unavailable', baseline: before ?? null, candidate: after ?? null, delta: null, reason: 'Metric is unavailable for one or both snapshots' }];
      if (identityDifferences.length) return [field, { status: 'incomparable', baseline: before, candidate: after, delta: null, reason: 'PoB identity differs between observations' }];
      const difference = after.value - before.value;
      if (!Number.isFinite(difference)) return [field, { status: 'unavailable', baseline: before, candidate: after, delta: null, reason: 'Numeric difference is not finite' }];
      return [field, { status: identityUnknown.length ? 'identity_unverified' : 'available', baseline: before, candidate: after, delta: difference }];
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ baseline: { snapshotId: left.snapshotId, treeVersion: baselineTreeVersion, identity: left.identity, treeObservationIdentity: leftTree.identity, context: left.context, warnings: [...new Set([...left.warnings, ...leftTree.warnings])] }, candidate: { snapshotId: right.snapshotId, treeVersion: candidateTreeVersion, identity: right.identity, treeObservationIdentity: rightTree.identity, context: right.context, warnings: [...new Set([...right.warnings, ...rightTree.warnings])] }, comparability: { identityDifferences, identityUnknown, configDifferent, treeVersionStatus }, metrics,
      warnings: ['Differences compare the saved contexts; different skills, enemy conditions, settings or tree versions can change the result independently of gear or passive changes.', 'Numeric differences do not identify the better build, account for play style, or verify legality.'] }) }] };
  } };
}
