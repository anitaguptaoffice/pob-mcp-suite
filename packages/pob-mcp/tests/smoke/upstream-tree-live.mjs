import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-upstream-tree-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'false', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'false', POE_SESSION_ID: '', POB_DIRECTORY: dir });
const child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'upstream-tree-live', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const tools = await mcp.request('tools/list', {});
  assert.equal(tools.result.tools.filter(tool => tool.name === 'inspect_upstream_tree_nodes').length, 1);
  const call = async args => { const r = await mcp.request('tools/call', { name: 'inspect_upstream_tree_nodes', arguments: args }); assert.ok(!r.error && !r.result?.isError, JSON.stringify(r)); return JSON.parse(r.result.content[0].text); };
  const first = await call({ tree_version: '3_13', node_ids: [38999, 2147483647] });
  assert.deepEqual(first.nodes.map(node => node.status), ['found', 'not_found']);
  assert.match(first.nodes[0].serializedLua, /Flawless Savagery/);
  const cached = await call({ tree_version: '3_13', node_ids: [38999] });
  assert.equal(cached.fetchedAt, first.fetchedAt); assert.equal(cached.sha256, first.sha256);
  const response = await fetch(first.url, { signal: AbortSignal.timeout(60000) }); assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), first.sha256);
  assert.ok(bytes.toString('utf8').includes(first.nodes[0].serializedLua));
  const refreshed = await call({ tree_version: '3_13', node_ids: [38999], refresh: true });
  assert.ok(Date.parse(refreshed.fetchedAt) >= Date.parse(first.fetchedAt));
  const alternate = await call({ tree_version: '3_28_alternate', node_ids: [52349] });
  assert.equal(alternate.treeVersion, '3_28_alternate');
  assert.equal(alternate.nodes[0].status, 'found');
  assert.match(alternate.nodes[0].serializedLua, /The King's Contempt/);
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('upstream tree live source, cache and MCP passed');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
