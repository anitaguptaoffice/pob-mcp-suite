import { createMasteryRankingTool } from '../../src/features/masteryRanking/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const parent = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: 'a', adapterVersion: 'b', dataVersion: 'c', runtimeVersion: 'd', executableVersion: 'e' };
const sample = (value: number | null, config = {}) => ({ snapshotId: parent, identity, warnings: [], metrics: { MinionCombinedDPS: value === null ? { status: 'unknown', value: null } : { status: 'available', value } }, context: { skills: { mainSocketGroup: 1, groups: [{ index: 1, mainActiveSkill: 1 }] }, config, build: {} } });
const options = { allocated: true, allocatedEffect: 1, nodeId: 10, treeVersion: '3_29', availableEffects: [{ effectId: 2, stat: 'one' }, { effectId: 3, stat: 'two' }], identity, warnings: [] };
const setup = () => {
  const masteryNodeOptions = jest.fn().mockResolvedValue(options);
  const deriveMasteries = jest.fn().mockResolvedValue({ id: child, parentId: parent });
  const evaluate = jest.fn().mockResolvedValueOnce(sample(100)).mockResolvedValueOnce(sample(120)).mockResolvedValueOnce(sample(90));
  return { masteryNodeOptions, deriveMasteries, evaluate, tool: createMasteryRankingTool({ masteryNodeOptions, deriveMasteries, evaluate } as unknown as Pick<BuildFoundation, 'masteryNodeOptions' | 'deriveMasteries' | 'evaluate'>) };
};
const args = { snapshot_id: parent, node_id: 10, effect_ids: [2, 3, 999], metric: 'MinionCombinedDPS' };
describe('snapshot mastery ranking', () => {
  it('evaluates each explicit candidate from the same parent and ranks only available effects', async () => {
    const test = setup(); const report = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(test.deriveMasteries.mock.calls).toEqual([[parent, { 10: 2 }, true], [parent, { 10: 3 }, true]]);
    expect(report.rankedEffectIds).toEqual([2, 3]);
    expect(report.results[0]).toMatchObject({ effectId: 2, status: 'ok', delta: 20, percent: 20, snapshotId: child });
    expect(report.results[2]).toMatchObject({ effectId: 999, status: 'unavailable' });
    expect(report.currentEffect).toBe(1);
  });
  it('does not rank missing metrics, changed configuration or failed candidates', async () => {
    const test = setup();
    test.evaluate.mockReset().mockResolvedValueOnce(sample(100)).mockResolvedValueOnce(sample(null)).mockResolvedValueOnce(sample(90, { enemyIsBoss: 'Uber' }));
    const report = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(report.rankedEffectIds).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: 'unranked', reason: 'Requested metric is unavailable' });
    expect(report.results[1]).toMatchObject({ status: 'unranked', reason: 'PoB configuration changed' });
    const failed = setup(); failed.deriveMasteries.mockRejectedValueOnce(new Error('effect unavailable'));
    const result = JSON.parse((await failed.tool.invoke(args)).content[0].text);
    expect(result.results[0]).toMatchObject({ status: 'error', reason: 'effect unavailable' });
  });
  it('rejects unallocated mastery and invalid or duplicate requests', async () => {
    const test = setup(); test.masteryNodeOptions.mockResolvedValueOnce({ ...options, allocated: false });
    await expect(test.tool.invoke(args)).rejects.toThrow('not allocated');
    await expect(test.tool.invoke({ ...args, effect_ids: [2, 2] })).rejects.toThrow('Invalid mastery ranking');
    expect(test.deriveMasteries).not.toHaveBeenCalled();
  });
  it('does not rank observations made with different PoB data identities', async () => {
    const test = setup();
    test.evaluate.mockReset().mockResolvedValueOnce(sample(100)).mockResolvedValueOnce({ ...sample(120), identity: { ...identity, dataVersion: 'changed' } });
    const report = JSON.parse((await test.tool.invoke({ ...args, effect_ids: [2] })).content[0].text);
    expect(report.rankedEffectIds).toEqual([]);
    expect(report.results[0].reason).toContain('dataVersion');
  });
});
