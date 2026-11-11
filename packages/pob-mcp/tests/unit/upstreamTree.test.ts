import { createHash } from 'node:crypto';
import { GitHubUpstreamTree } from '../../src/adapters/upstreamTree/github.js';
import { createUpstreamTreeTool, extractUpstreamNodes } from '../../src/features/upstreamTree/tool.js';

const fixture = `return {\n    ["nodes"]= {\n        [10]= {\n            ["name"]= "Node { quoted }",\n            ["stats"]= { "A \\\"quoted\\\" value" }\n        },\n        [20]= { ["name"]= "Other" }\n    }\n}`;
const response = () => new Response(fixture, { status: 200 });
it('extracts only requested nodes, skips braces inside strings, and rejects unsupported layout', () => {
  const nodes = extractUpstreamNodes(fixture, [10, 20, 30]);
  expect(nodes.map(node => node.status)).toEqual(['found', 'found', 'not_found']);
  expect(nodes[0].serializedLua).toContain('A \\\"quoted\\\" value');
  expect(nodes[2].serializedLua).toBeNull();
  expect(() => extractUpstreamNodes(fixture.replace('    ["nodes"]', '  ["nodes"]'), [10])).toThrow('layout');
  expect(() => extractUpstreamNodes(fixture.replace('"Other"', '[[long string]]'), [20])).toThrow('long string');
  expect(() => extractUpstreamNodes(fixture.replace('[20]', '[10]'), [10])).toThrow('Duplicate');
});
it('retains the actual fetch time on cache hits, refreshes explicitly, and does not cache errors', async () => {
  let clock = 1000;
  const fetcher = jest.fn(async () => response());
  const source = new GitHubUpstreamTree(fetcher as unknown as typeof fetch, () => clock);
  const first = await source.read('3_13'); clock += 1000;
  const cached = await source.read('3_13'); expect(cached.fetchedAt).toBe(first.fetchedAt); expect(fetcher).toHaveBeenCalledTimes(1);
  cached.sha256 = 'tampered'; expect((await source.read('3_13')).sha256).toBe(first.sha256);
  const fresh = await source.read('3_13', true); expect(fresh.fetchedAt).not.toBe(first.fetchedAt); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(first.sha256).toBe(createHash('sha256').update(fixture).digest('hex'));
  await expect(source.read('../3_13')).rejects.toThrow('Invalid');
  const failure = jest.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(response());
  const retry = new GitHubUpstreamTree(failure as unknown as typeof fetch);
  await expect(retry.read('3_13')).rejects.toThrow('404'); await retry.read('3_13'); expect(failure).toHaveBeenCalledTimes(2);
});
it('exposes provenance and never treats a missing node as a zero or executes remote data', async () => {
  const source = new GitHubUpstreamTree(jest.fn(async () => response()) as unknown as typeof fetch);
  const tool = createUpstreamTreeTool(source);
  const result = JSON.parse((await tool.invoke({ tree_version: '3_13', node_ids: [10, 30] })).content[0].text);
  expect(result.nodes.map((node: any) => node.status)).toEqual(['found', 'not_found']);
  expect(result).toMatchObject({ treeVersion: '3_13', bytes: Buffer.byteLength(fixture), source: 'pob-upstream-github' });
  await expect(tool.invoke({ tree_version: '3_13', node_ids: [10, 10] })).rejects.toThrow('Invalid');
  const mismatch = { read: async () => ({ ...(await source.read('3_13')), sha256: 'a'.repeat(64) }) };
  await expect(createUpstreamTreeTool(mismatch).invoke({ tree_version: '3_13', node_ids: [10] })).rejects.toThrow('provenance');
});
it('rejects oversized and invalid UTF-8 source responses', async () => {
  const oversized = new GitHubUpstreamTree(jest.fn(async () => new Response(fixture, { headers: { 'content-length': String(33 * 1024 * 1024) } })) as unknown as typeof fetch);
  await expect(oversized.read('3_13')).rejects.toThrow('size limit');
  const invalid = new GitHubUpstreamTree(jest.fn(async () => new Response(new Uint8Array([0xff]))) as unknown as typeof fetch);
  await expect(invalid.read('3_13')).rejects.toThrow('UTF-8');
});
