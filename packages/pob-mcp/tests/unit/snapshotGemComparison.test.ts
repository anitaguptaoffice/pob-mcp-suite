import { createSnapshotGemComparisonTool } from '../../src/features/snapshotGemComparison/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
const parent = 'a'.repeat(64), child = 'b'.repeat(64), intermediate = 'c'.repeat(64), unrelated = 'd'.repeat(64);
const identity = { engineVersion: '1', adapterVersion: '2', dataVersion: '3', runtimeVersion: '4', executableVersion: '5' };
const skills = (supportLevel: number) => ({ mainSocketGroup: 1, calcsSkillNumber: 1, groups: [{ index: 1, enabled: true, slotEnabled: true, gems: [{ name: 'SRS', isSupport: false, enabled: true }, { name: 'Support', isSupport: true, enabled: true, level: supportLevel }] }, { index: 2, enabled: true, gems: [] }] });
const observe = (id: string, level: number) => ({ snapshotId: id, identity, warnings: [], data: { tree: { nodes: [1] }, items: [], skills: skills(level), config: { enemyIsBoss: 'Pinnacle' } } });
const evaluation = (id: string, level: number, damage: number) => ({ snapshotId: id, identity, warnings: [], context: { skills: skills(level), config: { enemyIsBoss: 'Pinnacle' }, build: {} }, metrics: { MinionCombinedDPS: { status: 'available', value: damage }, TotalDPS: { status: 'unknown', value: null } } });
function setup() {
  const readSnapshot = jest.fn(async (id: string) => ({ id, parentId: id === child ? intermediate : id === intermediate ? parent : null }));
  const inspect = jest.fn(async (id: string) => observe(id, id === parent ? 20 : 21));
  const evaluate = jest.fn(async (id: string) => evaluation(id, id === parent ? 20 : 21, id === parent ? 100 : 125));
  return { readSnapshot, inspect, evaluate, tool: createSnapshotGemComparisonTool({ readSnapshot, inspect, evaluate } as unknown as Pick<BuildFoundation, 'readSnapshot' | 'inspect' | 'evaluate'>) };
}
const args = { snapshot_id: parent, group_index: 1, candidate_snapshot_ids: [child] };
describe('snapshot gem comparison', () => {
  it('compares a descendant against one parent and keeps minion damage separate', async () => {
    const test = setup(); const result = JSON.parse((await test.tool.invoke(args)).content[0].text);
    expect(result.results[0]).toMatchObject({ snapshotId: child, status: 'ok', ancestryDepth: 2, metrics: { MinionCombinedDPS: { delta: 25 }, TotalDPS: { delta: null } } });
    expect(test.readSnapshot.mock.calls.map(call => call[0])).toEqual([child, intermediate]);
  });
  it('reports unrelated ancestry and changed config as per-candidate errors', async () => {
    const test = setup();
    const wrong = JSON.parse((await test.tool.invoke({ ...args, candidate_snapshot_ids: [unrelated] })).content[0].text);
    expect(wrong.results[0].error).toContain('not a descendant');
    const changed = setup(); changed.inspect.mockImplementation(async id => { const value = observe(id, id === parent ? 20 : 21); if (id !== parent) value.data.config = { enemyIsBoss: 'Uber' }; return value; });
    const result = JSON.parse((await changed.tool.invoke(args)).content[0].text);
    expect(result.results[0].error).toContain('unrelated config');
  });
  it('rejects changes outside the selected group and preserves failure isolation', async () => {
    const test = setup(); test.inspect.mockImplementation(async id => { const value = observe(id, id === parent ? 20 : 21); if (id !== parent) value.data.skills.groups[1].enabled = false; return value; });
    expect(JSON.parse((await test.tool.invoke(args)).content[0].text).results[0].error).toContain('another skill group');
    await expect(test.tool.invoke({ ...args, candidate_snapshot_ids: [child, child] })).rejects.toThrow('Invalid snapshot gem');
  });
  it('does not compare across known PoB identity changes', async () => {
    const test = setup(); test.evaluate.mockImplementation(async id => ({ ...evaluation(id, id === parent ? 20 : 21, 100), identity: id === parent ? identity : { ...identity, dataVersion: 'changed' } }));
    expect(JSON.parse((await test.tool.invoke(args)).content[0].text).results[0].error).toContain('identity differs');
  });
});
