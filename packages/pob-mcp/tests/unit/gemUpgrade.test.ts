import { createGemUpgradeTool } from '../../src/features/gemUpgrade/tool.js';
import { compareSnapshotGemSetups } from '../../src/features/snapshotGemComparison/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

jest.mock('../../src/features/snapshotGemComparison/tool.js', () => ({ compareSnapshotGemSetups: jest.fn() }));
const parent = 'a'.repeat(64), child = 'b'.repeat(64);

describe('snapshot gem upgrades', () => {
  const compare = jest.mocked(compareSnapshotGemSetups);
  beforeEach(() => compare.mockReset());
  it('creates independent trial snapshots and retains partial comparison failures', async () => {
    const deriveGem = jest.fn().mockResolvedValueOnce({ id: child, parentId: parent }).mockRejectedValueOnce(new Error('Gem not found'));
    compare.mockResolvedValueOnce({ baseline: { metrics: { MinionCombinedDPS: 100 } }, results: [{ snapshotId: child, status: 'ok', metrics: { MinionCombinedDPS: { delta: 20 } } }] } as never);
    const tool = createGemUpgradeTool({ deriveGem } as unknown as Pick<BuildFoundation, 'deriveGem' | 'readSnapshot' | 'inspect' | 'evaluate'>);
    const report = JSON.parse((await tool.invoke({ snapshot_id: parent, group_index: 2, candidates: [{ gem_index: 1, level: 21 }, { gem_index: 99, quality: 20 }] })).content[0].text);
    expect(deriveGem).toHaveBeenNthCalledWith(1, parent, 2, 1, { level: 21 }, true);
    expect(deriveGem).toHaveBeenNthCalledWith(2, parent, 2, 99, { quality: 20 }, true);
    expect(compare).toHaveBeenCalledWith(expect.anything(), { snapshot_id: parent, group_index: 2, candidate_snapshot_ids: [child] });
    expect(report.results[0]).toMatchObject({ snapshotId: child, comparison: { status: 'ok', metrics: { MinionCombinedDPS: { delta: 20 } } } });
    expect(report.results[1]).toMatchObject({ comparison: { status: 'error', error: 'Gem not found' } });
  });
  it('reports created trial when comparison fails and rejects malformed or duplicate candidates', async () => {
    const deriveGem = jest.fn().mockResolvedValue({ id: child, parentId: parent });
    compare.mockRejectedValueOnce(new Error('Comparison unavailable'));
    const tool = createGemUpgradeTool({ deriveGem } as unknown as Pick<BuildFoundation, 'deriveGem' | 'readSnapshot' | 'inspect' | 'evaluate'>);
    const report = JSON.parse((await tool.invoke({ snapshot_id: parent, group_index: 1, candidates: [{ gem_index: 1, quality: 0 }] })).content[0].text);
    expect(report.results[0]).toMatchObject({ snapshotId: child, comparison: { status: 'error', error: 'Comparison unavailable' } });
    await expect(tool.invoke({ snapshot_id: parent, group_index: 1, candidates: [{ gem_index: 1 }] })).rejects.toThrow('Invalid gem upgrade options');
    await expect(tool.invoke({ snapshot_id: parent, group_index: 1, candidates: [{ gem_index: 1, level: 21 }, { level: 21, gem_index: 1 }] })).rejects.toThrow('Duplicate gem upgrade candidates');
  });
});
