import { createSupportContributionsTool } from '../../src/features/snapshotGemComparison/contributions.js';

const parent = 'a'.repeat(64), child = 'b'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const skills = (disabled = false) => ({ mainSocketGroup: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [
  { index: 1, name: 'SRS', isSupport: false, enabled: true },
  { index: 2, name: 'Minion Damage', isSupport: true, enabled: !disabled, appliedToSelectedSkill: !disabled },
  { index: 3, name: 'Unknown', isSupport: true, enabled: true, appliedToSelectedSkill: null },
] }] });
function setup() {
  const inspect = jest.fn(async (id: string) => ({ identity, warnings: [], data: { tree: {}, items: [], config: {}, skills: skills(id === child) } }));
  const evaluate = jest.fn(async (id: string) => ({ identity, warnings: [], context: { config: {}, skills: skills(id === child) }, metrics: { MinionCombinedDPS: { status: 'available', value: id === child ? 60 : 100 } } }));
  const readSnapshot = jest.fn(async () => ({ id: child, parentId: parent }));
  const deriveGem = jest.fn(async () => ({ id: child, parentId: parent }));
  return { inspect, evaluate, readSnapshot, deriveGem, tool: createSupportContributionsTool({ inspect, evaluate, readSnapshot, deriveGem } as any) };
}

it('compares only confirmed applied supports against the parent and preserves unknowns', async () => {
  const t = setup();
  const value = JSON.parse((await t.tool.invoke({ snapshot_id: parent, group_index: 1, gem_indices: [2, 3] })).content[0].text);
  expect(t.deriveGem).toHaveBeenCalledTimes(1);
  expect(t.deriveGem).toHaveBeenCalledWith(parent, 1, 2, { enabled: false }, true);
  expect(value.results[0]).toMatchObject({ status: 'ok', snapshotId: child, comparison: { metrics: { MinionCombinedDPS: { delta: -40 } } } });
  expect(value.results[1]).toMatchObject({ gemIndex: 3, status: 'unavailable' });
});

it('returns the trial ID when comparison fails and rejects invalid indices', async () => {
  const t = setup();
  t.readSnapshot.mockResolvedValue({ id: child, parentId: 'c'.repeat(64) });
  const value = JSON.parse((await t.tool.invoke({ snapshot_id: parent, group_index: 1, gem_indices: [2] })).content[0].text);
  expect(value.results[0]).toMatchObject({ status: 'error', snapshotId: child });
  await expect(t.tool.invoke({ snapshot_id: parent, group_index: 1, gem_indices: [2, 2] })).rejects.toThrow('Invalid support contribution options');
});

it('withholds results if discovered skills no longer match the comparison baseline', async () => {
  const t = setup();
  t.inspect.mockImplementation(async id => ({ identity, warnings: [], data: { tree: {}, items: [], config: {}, skills: skills(id === child || t.inspect.mock.calls.length > 1) } }));
  const value = JSON.parse((await t.tool.invoke({ snapshot_id: parent, group_index: 1, gem_indices: [2] })).content[0].text);
  expect(value.results[0]).toMatchObject({ status: 'error', snapshotId: child });
  expect(value.results[0].reason).toContain('Baseline skill');
});
