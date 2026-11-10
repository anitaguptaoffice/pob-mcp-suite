import { createSnapshotSupportRankingTool } from '../../src/features/snapshotSupportRanking/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const skills = (applied: boolean | null = true) => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, mainActiveSkill: 1, selectedSkillPart: 1, gems: [{ index: 1, name: 'SRS', isSupport: false, enabled: true }, { index: 2, name: 'Support', isSupport: true, enabled: true, appliedToSelectedSkill: applied }] }] });
const result = (value: number | null, applied: boolean | null = true) => ({ identity, warnings: [], context: { skills: skills(applied), config: {}, build: {} }, metrics: { MinionCombinedDPS: value === null ? { status: 'unknown', value: null } : { status: 'available', value } } });
const args = { snapshot_id: id, group_index: 1, gem_index: 2, metric: 'MinionCombinedDPS', candidates: [{ gem_name: 'One Support' }, { gem_name: 'Two Support', level: 18, quality: 10 }] };
function setup() {
  const evaluate = jest.fn().mockResolvedValueOnce(result(100)).mockResolvedValueOnce(result(120)).mockResolvedValueOnce(result(80));
  const deriveSupportReplacement = jest.fn().mockResolvedValue({ id: child, parentId: id });
  return { evaluate, deriveSupportReplacement, tool: createSnapshotSupportRankingTool({ evaluate, deriveSupportReplacement } as unknown as Pick<BuildFoundation, 'evaluate' | 'deriveSupportReplacement'>) };
}
describe('snapshot support ranking', () => {
  it('ranks only explicit applied supports using poison-inclusive minion metric from the same parent', async () => {
    const test = setup(); const report = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(report.rankedCandidates).toEqual(['One Support', 'Two Support']);
    expect(report.results[0]).toMatchObject({ status: 'ok', delta: 20, percent: 20 });
    expect(test.deriveSupportReplacement.mock.calls).toEqual([[id, 1, 2, { gemName: 'One Support' }, true], [id, 1, 2, { gemName: 'Two Support', level: 18, quality: 10 }, true]]);
  });
  it('leaves non-applied and unknown supports unranked without dropping them', async () => {
    const test = setup(); test.evaluate.mockReset().mockResolvedValueOnce(result(100)).mockResolvedValueOnce(result(120, false)).mockResolvedValueOnce(result(80, null));
    const report = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(report.rankedCandidates).toEqual([]);
    expect(report.results[0].reason).toContain('not applied'); expect(report.results[1].reason).toContain('unknown');
  });
  it('allows metrics for which lower is preferable', async () => {
    const test = setup(); const report = JSON.parse((await test.tool.invoke({ ...args, direction: 'lower' })).content[0].text);
    expect(report.direction).toBe('lower'); expect(report.rankedCandidates).toEqual(['Two Support', 'One Support']);
  });
  it('isolates failed candidates and rejects duplicate names before calculation', async () => {
    const test = setup(); test.deriveSupportReplacement.mockRejectedValueOnce(new Error('missing gem'));
    const report = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(report.results[0]).toMatchObject({ status: 'error', reason: 'missing gem' });
    await expect(test.tool.invoke({ ...args, candidates: [{ gem_name: 'one' }, { gem_name: 'One Support' }] })).rejects.toThrow('Duplicate');
  });
});
