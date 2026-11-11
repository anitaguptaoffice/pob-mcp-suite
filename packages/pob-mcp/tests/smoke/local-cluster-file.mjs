import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-cluster-file-'));
let child;
try {
  const xml = await readFile(resolve('tests/fixtures/cluster-toxic-rain.xml'), 'utf8');
  await writeFile(join(dir, 'fixture.xml'), xml);
  const mcp = startMcpServer({ POE_TRADE_ENABLED: 'false', POB_DIRECTORY: dir });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cluster-file-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const tools = await mcp.request('tools/list', {});
  assert.equal(tools.result.tools.filter(t => t.name === 'inspect_local_cluster_jewels').length, 1);
  assert.ok(tools.result.tools.some(t => t.name === 'foundation_import_build'));
  const response = await mcp.request('tools/call', { name: 'inspect_local_cluster_jewels', arguments: { build_name: 'fixture.xml' } });
  assert.ok(!response.result?.isError, JSON.stringify(response)); const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.activeSpec, 3); assert.equal(result.treeVersion, '3_13'); assert.equal(result.jewels.length, 11);
  assert.equal(result.jewels.find(j => j.socketNodeId === 21984).itemId, 27); assert.ok(result.sha256.match(/^[a-f0-9]{64}$/));
  const invalid = await mcp.request('tools/call', { name: 'inspect_local_cluster_jewels', arguments: { build_name: '../other.xml' } });
  assert.equal(invalid.result.isError, true); assert.equal(await readFile(join(dir, 'fixture.xml'), 'utf8'), xml);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('local cluster file passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
