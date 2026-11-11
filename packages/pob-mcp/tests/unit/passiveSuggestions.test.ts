import { createPassiveSuggestionsTool } from '../../src/features/passiveSuggestions/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64);
const node = (id: number, type = 'notable') => ({ id, name: `Node ${id}`, type, stats: ['Minions deal increased Damage'], allocated: false });

function setup() {
  const searchNodes = jest.fn(async ({ keyword, nodeType }: { keyword: string; nodeType: string }) => {
    const nodes = nodeType === 'keystone' ? [node(3, 'keystone')] : keyword === 'minion damage' ? [node(1), node(2)] : [node(2)];
    return { nodes, count: nodes.length };
  });
  const engine = { getTree: async () => ({ treeVersion: '3_29' }), getSkills: async () => ({ groups: [{ gems: [{ name: 'Summon Raging Spirit', enabled: false }] }] }), searchNodes };
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ snapshotId: id, identity: { dataVersion: 'data' }, warnings: [], result: await callback(engine) }));
  return { tool: createPassiveSuggestionsTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>), searchNodes };
}

describe('snapshot passive suggestions', () => {
  it('uses legacy goal and gem keywords, deduplicates and reports bounded searches', async () => {
    const { tool, searchNodes } = setup();
    const result = JSON.parse((await tool.invoke({ snapshot_id: id, goal: 'damage', limit: 2 })).content[0].text);
    expect(result).toMatchObject({ snapshotId: id, treeVersion: '3_29', inferredArchetypes: ['minion'], returnedCount: 2, outputTruncated: true });
    expect(searchNodes.mock.calls.map(call => call[0].keyword)).toEqual(['minion damage', 'damage', 'critical', 'minion damage']);
    expect(result.candidates[1]).toMatchObject({ node: { id: 2 }, matchedKeywords: ['minion damage', 'damage', 'critical'] });
    expect(result.warnings.join(' ')).toMatch(/disabled gems/);
  });
  it('rejects invalid inputs and inconsistent PoB results', async () => {
    const { tool, searchNodes } = setup();
    await expect(tool.invoke({ snapshot_id: id, goal: ' ', limit: 2 })).rejects.toThrow('Invalid passive suggestion options');
    searchNodes.mockResolvedValueOnce({ nodes: [node(1)], count: 2 });
    await expect(tool.invoke({ snapshot_id: id, goal: 'life' })).rejects.toThrow('invalid passive suggestions');
    searchNodes.mockResolvedValueOnce({ nodes: [{ ...node(1), allocated: true }], count: 1 });
    await expect(tool.invoke({ snapshot_id: id, goal: 'life' })).rejects.toThrow('invalid passive suggestion node');
  });
  it('discloses an engine search hitting its bound', async () => {
    const { tool, searchNodes } = setup();
    searchNodes.mockResolvedValueOnce({ nodes: Array.from({ length: 10 }, (_, i) => node(i + 1)), count: 10 });
    const result = JSON.parse((await tool.invoke({ snapshot_id: id, goal: 'life' })).content[0].text);
    expect(result.searches[0].possiblyTruncated).toBe(true);
  });
  it('treats object prototype names as ordinary custom goals', async () => {
    const { tool, searchNodes } = setup();
    await tool.invoke({ snapshot_id: id, goal: 'constructor' });
    expect(searchNodes.mock.calls.map(call => call[0].keyword)).toEqual(['minion', 'constructor', 'minion']);
  });
});
