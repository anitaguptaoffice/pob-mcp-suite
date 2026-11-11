import { createDiscoveredSupportRankingTool } from '../../src/features/snapshotSupportRanking/discovered.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const id = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const candidate = (name: string, alreadySocketed = false) => ({ id: name, name, alreadySocketed, exceptional: false });
const skills = { mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, mainActiveSkill: 1, gems: [{ index: 1, name: 'Skill', isSupport: false, enabled: true }, { index: 2, name: 'Support', isSupport: true, enabled: true, appliedToSelectedSkill: true }] }] };
const args = { snapshot_id: id, group_index: 1, gem_index: 2, metric: 'MinionCombinedDPS' };
function setup() {
  const compatibleSupports = jest.fn().mockResolvedValue({ groupIndex: 1, total: 4, failed: 0, identity, warnings: [], candidates: [candidate('Socketed', true), candidate('First Support'), candidate('First'), candidate('Second Support')] });
  const evaluate = jest.fn().mockResolvedValue({ identity, warnings: [], context: { skills, config: {}, build: {} }, metrics: { MinionCombinedDPS: { status: 'available', value: 100 } } });
  const deriveSupportReplacement = jest.fn().mockResolvedValue({ id: child, parentId: id });
  const tool = createDiscoveredSupportRankingTool({ compatibleSupports, evaluate, deriveSupportReplacement } as unknown as Pick<BuildFoundation, 'compatibleSupports' | 'evaluate' | 'deriveSupportReplacement'>);
  return { tool, compatibleSupports, evaluate, deriveSupportReplacement };
}
it('ranks a bounded deduplicated list of unsocketed compatible candidates', async () => {
  const t = setup();
  const report = JSON.parse((await t.tool.invoke({ ...args, limit: 1 })).content[0].text);
  expect(report.status).toBe('evaluated');
  expect(report.discovery).toMatchObject({ total: 4, returned: 4, eligibleReturned: 2 });
  expect(report.ranking.rankedCandidates).toEqual(['First Support']);
  expect(t.deriveSupportReplacement).toHaveBeenCalledTimes(1);
  expect(t.compatibleSupports).toHaveBeenCalledWith(id, expect.objectContaining({ groupIndex: 1, limit: 100 }));
});
it('exposes partial discovery and withholds ranking when identities change', async () => {
  const t = setup();
  t.compatibleSupports.mockResolvedValueOnce({ groupIndex: 1, total: 1, failed: 1, identity: { ...identity, dataVersion: 'other' }, warnings: [], candidates: [candidate('First Support')] });
  const report = JSON.parse((await t.tool.invoke(args)).content[0].text);
  expect(report.status).toBe('identity_mismatch');
  expect(report.ranking.rankedCandidates).toEqual([]);
  expect(report.ranking.results[0]).toMatchObject({ status: 'unranked', snapshotId: child, delta: null });
});
it('reports a partial outcome when a discovered candidate fails', async () => {
  const t = setup();
  t.deriveSupportReplacement.mockRejectedValueOnce(new Error('fixture failure'));
  const report = JSON.parse((await t.tool.invoke({ ...args, limit: 2 })).content[0].text);
  expect(report.status).toBe('partial');
  expect(report.ranking.results[0]).toMatchObject({ status: 'error', reason: 'fixture failure' });
  expect(report.ranking.results[1].status).toBe('ok');
});
it('does not start calculations for no candidates or invalid input', async () => {
  const t = setup();
  t.compatibleSupports.mockResolvedValueOnce({ groupIndex: 1, total: 1, failed: 0, identity, warnings: [], candidates: [candidate('Already', true)] });
  const report = JSON.parse((await t.tool.invoke(args)).content[0].text);
  expect(report.status).toBe('no_candidates'); expect(t.evaluate).not.toHaveBeenCalled();
  await expect(t.tool.invoke({ ...args, limit: 5 })).rejects.toThrow('Invalid');
});
