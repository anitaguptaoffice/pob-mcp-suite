import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-timeless-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  await client.start();
  await client.newBuild({ className: 'Witch' });
  await client.setTree({ classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
  const xml = await client.exportBuildXml();
  const oldResult = await client.findTimelessJewelSeeds({ socketNodeId: 60735, desired: ['eternal_notable_minion_1'], seeds: [130660] });
  assert.equal(oldResult[0].score, 5);
  assert.deepEqual(oldResult[0].hits.map(hit => hit.nodeId).sort((a,b) => a-b), [2715, 4481, 13935, 18707, 31508]);
  await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child;
  child.stderr.on('data', () => {});
  const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'timeless-smoke', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const call = async (name, args) => {
    const response = await mcp.request('tools/call', { name, arguments: args });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const parent = await call('foundation_import_build', { xml, source: 'timeless-fixture' });
  const args = { snapshot_id: parent.id, socket_node_id: 60735, desired_node_ids: ['eternal_notable_minion_1'], seeds: [130660] };
  const result = await call('search_snapshot_timeless_seeds', args);
  assert.equal(result.snapshotId, parent.id);
  assert.equal(result.treeVersion, '3_29');
  assert.equal(result.scannedSeeds, 1);
  assert.equal(result.totalMatches, 1);
  assert.equal(result.results[0].seed, 130660);
  assert.equal(result.results[0].score, 5);
  assert.deepEqual(result.results[0].hits.map(hit => hit.nodeId).sort((a,b) => a-b), [2715, 4481, 13935, 18707, 31508]);
  assert.ok(result.results[0].hits.every(hit => hit.allocated === false));
  const filtered = await call('search_snapshot_timeless_seeds', { ...args, required_source_node_ids: [4481] });
  assert.equal(filtered.totalMatches, 1);
  const keystone = await call('search_snapshot_timeless_seeds', { ...args, desired_node_ids: ['eternal_notable_minion_1', 'eternal_keystone_3_v2'], historic_figure: 'Caspiro', keystone_node_id: 54307 });
  assert.equal(keystone.results[0].score, 6);
  assert.ok(keystone.results[0].hits.some(hit => hit.nodeId === 54307 && hit.id === 'eternal_keystone_3_v2' && hit.static === true && hit.allocated === false));
  const noMatch = await call('search_snapshot_timeless_seeds', { ...args, seeds: [2000], required_source_node_ids: [4481] });
  assert.ok(Array.isArray(noMatch.results));
  const all = await call('search_snapshot_timeless_seeds', { ...args, seeds: undefined, limit: 1 });
  assert.equal(all.scannedSeeds, 7901);
  assert.equal(all.results[0].seed, 130660);
  for (const invalid of [
    { ...args, seeds: [2001] }, { ...args, seeds: [20] }, { ...args, seeds: [130660, 130660] },
    { ...args, desired_node_ids: ['not_a_real_node'] }, { ...args, required_source_node_ids: [60735] },
    { ...args, historic_figure: 'Caspiro', keystone_node_id: 60735 },
  ]) {
    const response = await mcp.request('tools/call', { name: 'search_snapshot_timeless_seeds', arguments: invalid });
    assert.equal(response.result?.isError, true, JSON.stringify(response));
  }
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end();
  assert.equal((await exited)[0], 0);
  console.log('foundation timeless search passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await client.stop();
  await rm(dir, { recursive: true, force: true });
}
