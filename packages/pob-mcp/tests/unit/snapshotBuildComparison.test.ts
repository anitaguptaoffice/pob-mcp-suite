import { createSnapshotBuildComparisonTool } from '../../src/features/buildComparison/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const first = 'a'.repeat(64), second = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const evaluation = (snapshotId: string, value: number | null, config: object = {}) => ({ snapshotId, identity, warnings: [], context: { build: {}, skills: {}, config }, metrics: { Life: value === null ? { status: 'unknown', value: null, reason: 'missing' } : { status: 'available', value } } });
const inspection = (snapshotId: string, treeVersion = '3_29') => ({ snapshotId, identity, warnings: [], data: { tree: { treeVersion } } });
const create = (left: unknown, right: unknown, treeLeft = inspection(first), treeRight = inspection(second)) => {
  const evaluate = jest.fn().mockResolvedValueOnce(left).mockResolvedValueOnce(right);
  const inspect = jest.fn().mockResolvedValueOnce(treeLeft).mockResolvedValueOnce(treeRight);
  return { evaluate, inspect, tool: createSnapshotBuildComparisonTool({ evaluate, inspect } as unknown as Pick<BuildFoundation, 'evaluate' | 'inspect'>) };
};
const args = { baseline_snapshot_id: first, candidate_snapshot_id: second, fields: ['Life'] };
const parse = async (tool: ReturnType<typeof createSnapshotBuildComparisonTool>) => JSON.parse((await tool.invoke(args)).content[0].text);

describe('snapshot build comparison', () => {
  it('calculates differences in each saved context and marks changed config and tree', async () => {
    const { tool, evaluate, inspect } = create(evaluation(first, 100, { boss: false }), evaluation(second, 125, { boss: true }), inspection(first), inspection(second, '3_28'));
    const result = await parse(tool);
    expect(result.metrics.Life).toEqual({ status: 'available', baseline: { status: 'available', value: 100 }, candidate: { status: 'available', value: 125 }, delta: 25 });
    expect(result.comparability).toEqual({ identityDifferences: [], identityUnknown: [], configDifferent: true, treeVersionStatus: 'different' });
    expect(result.baseline.context.config).toEqual({ boss: false });
    expect(evaluate.mock.calls).toEqual([[first, ['Life']], [second, ['Life']]]);
    expect(inspect.mock.calls).toEqual([[first, ['tree']], [second, ['tree']]]);
  });
  it('reports missing metrics and refuses deltas when engine data changes between observations', async () => {
    const missing = create(evaluation(first, null), evaluation(second, 5));
    expect((await parse(missing.tool)).metrics.Life).toMatchObject({ status: 'unavailable', delta: null });
    const mismatched = create(evaluation(first, 1), { ...evaluation(second, 5), identity: { ...identity, dataVersion: 'other' } });
    expect((await parse(mismatched.tool)).metrics.Life).toMatchObject({ status: 'incomparable', delta: null });
    const changed = create(evaluation(first, 1), evaluation(second, 5), { ...inspection(first), identity: { ...identity, executableVersion: 'other' } });
    expect((await parse(changed.tool)).metrics.Life.status).toBe('incomparable');
  });
  it('marks identity gaps without claiming a verified comparison', async () => {
    const unknown = create({ ...evaluation(first, 0), identity: { ...identity, dataVersion: null } }, evaluation(second, 5));
    const result = await parse(unknown.tool);
    expect(result.comparability.identityUnknown).toContain('dataVersion');
    expect(result.metrics.Life).toMatchObject({ status: 'identity_unverified', delta: 5 });
    const unknownSnapshot = create({ ...evaluation(first, 0), warnings: ['dataVersion is unknown; compatibility cannot be established'] }, evaluation(second, 5));
    expect((await parse(unknownSnapshot.tool)).metrics.Life.status).toBe('identity_unverified');
  });
  it('rejects invalid fields and IDs before opening the engine', async () => {
    const { tool, evaluate } = create(evaluation(first, 1), evaluation(second, 2));
    for (const invalid of [{ ...args, fields: [] }, { ...args, fields: ['Life', 'Life'] }, { ...args, fields: [' Life'] }, { ...args, candidate_snapshot_id: 'wrong' }, { ...args, extra: true }]) await expect(tool.invoke(invalid)).rejects.toThrow('Invalid snapshot comparison');
    expect(evaluate).not.toHaveBeenCalled();
  });
});
