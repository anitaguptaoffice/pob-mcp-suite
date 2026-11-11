import { createMasteryRankingTool, createMasteryDiscoveryTool } from '../../src/features/masteryRanking/tool.js';
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
  it('discovers a deterministic page and exposes continuation without claiming global ranking', async () => {
    const test = setup();
    test.masteryNodeOptions.mockResolvedValueOnce({ ...options, availableEffects: [{ effectId: 3, stat: 'two' }, { effectId: 2, stat: 'one' }] });
    const report = JSON.parse((await test.tool.invoke({ snapshot_id: parent, node_id: 10, metric: 'MinionCombinedDPS', limit: 1 })).content[0].text);
    expect(report.candidateScope).toBe('discovered_page');
    expect(report.results.map((result: { effectId: number }) => result.effectId)).toEqual([2]);
    expect(report.totalAvailableEffects).toBe(2); expect(report.nextOffset).toBe(1);
    expect(report.warnings.join(' ')).toContain('not a global ranking');
    const next = setup();
    const nextReport = JSON.parse((await next.tool.invoke({ snapshot_id: parent, node_id: 10, metric: 'MinionCombinedDPS', offset: 1, limit: 1 })).content[0].text);
    expect(nextReport.results[0].effectId).toBe(3); expect(nextReport.nextOffset).toBeNull();
    await expect(next.tool.invoke({ ...args, offset: 1 })).rejects.toThrow('Invalid mastery ranking');
  });
  it('discovers all allocated mastery nodes and pages their effects deterministically', async () => {
    const masteryOptions = jest.fn().mockResolvedValue({ snapshotId: parent, treeVersion: '3_29', identity, warnings: [], masteries: [
      { nodeId: 20, nodeName: 'second', allocatedEffect: 4, availableEffects: [{ effectId: 4, stat: 'four' }] },
      { nodeId: 10, nodeName: 'first', allocatedEffect: 3, availableEffects: [{ effectId: 3, stat: 'three' }, { effectId: 2, stat: 'two' }] },
    ] });
    const tool = createMasteryDiscoveryTool({ masteryOptions } as unknown as Pick<BuildFoundation, 'masteryOptions'>);
    const first = JSON.parse((await tool.invoke({ snapshot_id: parent, limit: 2 })).content[0].text);
    expect(first.totalMasteries).toBe(2); expect(first.totalEffects).toBe(3); expect(first.nextOffset).toBe(2);
    expect(first.effects.map((entry: { effectId: number }) => entry.effectId)).toEqual([2, 3]);
    expect(first.effects[1].selected).toBe(true);
    const second = JSON.parse((await tool.invoke({ snapshot_id: parent, limit: 2, offset: first.nextOffset })).content[0].text);
    expect(second.effects[0]).toMatchObject({ nodeId: 20, effectId: 4, selected: true }); expect(second.nextOffset).toBeNull();
    masteryOptions.mockResolvedValueOnce({ snapshotId: parent, treeVersion: '3_29', identity, warnings: [], masteries: [] });
    expect(JSON.parse((await tool.invoke({ snapshot_id: parent })).content[0].text).effects).toEqual([]);
    masteryOptions.mockResolvedValueOnce({ snapshotId: parent, treeVersion: '3_29', identity, warnings: [], masteries: [{ nodeId: 10, availableEffects: [{ effectId: 2147483648 }] }] });
    await expect(tool.invoke({ snapshot_id: parent })).rejects.toThrow('invalid mastery discovery data');
  });
});
