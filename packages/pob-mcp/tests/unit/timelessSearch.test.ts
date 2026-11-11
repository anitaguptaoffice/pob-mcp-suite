import { createTimelessSearchTool } from '../../src/features/timelessSearch/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

const id = 'a'.repeat(64);
const hit = { nodeId: 4481, id: 'eternal_notable_minion_1', allocated: true, stats: ['Minions deal 80% increased Damage'] };
const args = { snapshot_id: id, socket_node_id: 60735, desired_node_ids: [hit.id], seeds: [130660], required_source_node_ids: [4481, 2715] };
const result = () => ({ socketNodeId: 60735, treeVersion: '3_29', jewelType: 'Elegant Hubris', scannedSeeds: 1, totalMatches: 1, results: [{ seed: 130660, score: 1, hits: [{ ...hit }] }] });
function setup(value: unknown) {
  const findTimelessJewelSeedsDetailed = jest.fn().mockResolvedValue(value);
  const runReadOnlySnapshot = jest.fn(async (_id, callback) => ({ snapshotId: id, warnings: [], result: await callback({ findTimelessJewelSeedsDetailed }) }));
  return createTimelessSearchTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
}

it('returns a valid result and describes the any-of source filter', async () => {
  const report = JSON.parse((await setup(result()).invoke(args)).content[0].text);
  expect(report.results[0].hits[0]).toEqual(hit);
  expect(report.warnings).toContain('A nonempty required_source_node_ids filter requires at least one matching source node, not all of them.');
});

it('rejects incomplete, inconsistent, or unrequested results', async () => {
  const bad = [
    { ...result(), scannedSeeds: 2 }, { ...result(), totalMatches: 2 },
    { ...result(), results: [] },
    { ...result(), results: [{ seed: 130680, score: 1, hits: [hit] }] },
    { ...result(), results: [{ seed: 130660, score: 2, hits: [hit] }] },
    { ...result(), results: [{ seed: 130660, score: 1, hits: [{ ...hit, id: 'other' }] }] },
    { ...result(), results: [{ seed: 130660, score: 1, hits: [{ ...hit, nodeId: 123 }] }] },
    { ...result(), results: [{ seed: 130660, score: 1, hits: [{ ...hit, allocated: null }] }] },
    { ...result(), results: [{ seed: 130660, score: 1, hits: [{ ...hit, static: true }] }] },
  ];
  for (const value of bad) await expect(setup(value).invoke(args)).rejects.toThrow(/invalid timeless|unmatched timeless/i);
});

it('rejects duplicate nodes, duplicate seeds and incorrect ordering', async () => {
  const two = { ...args, seeds: [130660, 130680] };
  const candidate = result().results[0];
  const base = { ...result(), scannedSeeds: 2, totalMatches: 2 };
  const bad = [
    { ...base, results: [candidate, candidate] },
    { ...base, results: [{ ...candidate, seed: 130680 }, candidate] },
    { ...result(), scannedSeeds: 2, results: [{ ...candidate, score: 2, hits: [hit, hit] }] },
  ];
  for (const value of bad) await expect(setup(value).invoke(two)).rejects.toThrow(/invalid timeless|unsorted timeless/i);
});
