import { createTreePathTools } from '../../src/features/treePaths/tool.js';
import type { BuildFoundation, BuildEngine } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64);
const pathNode = { id: 42, name: 'fixture', type: 'notable', stats: ['test'], allocated: false, isBlighted: false, status: 'reachable', pathNodes: [10, 42], pointCost: 2 };
const setup = (response: unknown) => {
  const queryTreePaths = jest.fn().mockResolvedValue(response);
  const runReadOnlySnapshot = jest.fn(async (_id: string, f: (engine: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: {}, warnings: [], result: await f({ queryTreePaths } as unknown as BuildEngine) }));
  const tools = createTreePathTools({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
  return { queryTreePaths, runReadOnlySnapshot, path: tools[0], nearby: tools[1] };
};

describe('snapshot tree paths', () => {
  it('returns the source snapshot native path and handles missing or allocated targets', async () => {
    const obj = setup({ mode: 'target', treeVersion: '3_29', status: 'found', targetNodeId: 42, node: pathNode });
    const result = JSON.parse((await obj.path.invoke({ snapshot_id: id, target_node_id: 42 })).content[0].text);
    expect(result.node.pathNodes).toEqual([10, 42]);
    expect(obj.queryTreePaths).toHaveBeenCalledWith({ targetNodeId: 42 });
    obj.queryTreePaths.mockResolvedValueOnce({ mode: 'target', treeVersion: '3_29', status: 'not_found', targetNodeId: 1 });
    expect(JSON.parse((await obj.path.invoke({ snapshot_id: id, target_node_id: 1 })).content[0].text).status).toBe('not_found');
    obj.queryTreePaths.mockResolvedValueOnce({ mode: 'target', treeVersion: '3_29', status: 'found', targetNodeId: 42, node: { ...pathNode, status: 'allocated', allocated: true, pointCost: 0, pathNodes: [] } });
    expect(JSON.parse((await obj.path.invoke({ snapshot_id: id, target_node_id: 42 })).content[0].text).node.status).toBe('allocated');
  });
  it('uses explicit distance and limit and rejects inconsistent PoB results', async () => {
    const obj = setup({ mode: 'nearby', treeVersion: '3_29', maxDistance: 3, total: 1, nodes: [pathNode] });
    const result = JSON.parse((await obj.nearby.invoke({ snapshot_id: id, filter: 'life' })).content[0].text);
    expect(obj.queryTreePaths).toHaveBeenCalledWith({ maxDistance: 3, limit: 30, filter: 'life' });
    expect(result.total).toBe(1);
    obj.queryTreePaths.mockResolvedValueOnce({ mode: 'nearby', treeVersion: '3_29', maxDistance: 3, total: 1, nodes: [{ ...pathNode, pathNodes: [42], pointCost: 2 }] });
    await expect(obj.nearby.invoke({ snapshot_id: id })).rejects.toThrow('invalid nearby paths');
  });
  it('rejects invalid input before opening an engine', async () => {
    const obj = setup({});
    for (const args of [{ snapshot_id: id, target_node_id: 0 }, { snapshot_id: 'x', target_node_id: 42 }, { snapshot_id: id, target_node_id: 42, extra: 1 }]) await expect(obj.path.invoke(args)).rejects.toThrow('Invalid tree path options');
    for (const args of [{ snapshot_id: id, max_distance: 0 }, { snapshot_id: id, limit: 101 }, { snapshot_id: id, filter: 'x'.repeat(201) }]) await expect(obj.nearby.invoke(args)).rejects.toThrow('Invalid tree path options');
    expect(obj.runReadOnlySnapshot).not.toHaveBeenCalled();
  });
});
