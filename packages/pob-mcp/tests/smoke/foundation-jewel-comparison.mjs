import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-jewel-compare-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  const xml = await readFile(resolve('tests/fixtures/cluster-toxic-rain.xml'), 'utf8');
  const jewel = 'Rarity: RARE\nTest Jewel\nCobalt Jewel\nImplicits: 0\n+50 to maximum Life';
  await client.start(); await client.loadBuildXml(xml);
  const tree = await client.getTree(); assert.ok(tree.nodes.includes(34483)); assert.ok(!tree.nodes.includes(9797));
  const before = await client.getStats(['Life']); await client.addItem(jewel, 'Jewel 34483');
  const after = await client.getStats(['Life']); assert.notEqual(before.Life, after.Life); await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jewel-comparison-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  const parent = await call('foundation_import_build', { xml, source: 'jewel-fixture' });
  const ids = (await call('foundation_list_snapshots', {})).snapshots.map(item => item.id).sort();
  const inactive = await mcp.request('tools/call', { name: 'foundation_derive_item', arguments: { snapshot_id: parent.id, slot: 'Jewel 9797', item_text: jewel } });
  assert.equal(inactive.result.isError, true); assert.match(inactive.result.content[0].text, /not allocated/);
  assert.deepEqual((await call('foundation_list_snapshots', {})).snapshots.map(item => item.id).sort(), ids);
  const result = await call('compare_snapshot_jewels', { snapshot_id: parent.id, socket_node_id: 34483, fields: ['Life'], candidates: [
    { name: 'life', item_text: jewel }, { name: 'unparsed', item_text: `${jewel}\n+42 to nonexistent imaginary statistic` }, { name: 'more-life', item_text: jewel.replace('+50', '+80') },
  ] });
  assert.equal(result.currentDiagnostics.status, 'available'); assert.equal(result.results.length, 3);
  const candidate = result.results[0]; assert.equal(candidate.status, 'compared'); assert.equal(candidate.snapshot.parentId, parent.id);
  assert.equal(candidate.comparison.metrics.Life.baseline.value, before.Life); assert.equal(candidate.comparison.metrics.Life.candidate.value, after.Life);
  assert.equal(candidate.comparison.contextDifferent, false);
  assert.ok(['available', 'identity_unverified'].includes(candidate.comparison.metrics.Life.status));
  assert.equal(candidate.comparison.metrics.Life.delta, after.Life - before.Life);
  assert.equal(candidate.parseDiagnostics.diagnostics.unparsed.length, 0);
  assert.ok(result.results[1].parseDiagnostics.diagnostics.unparsed.length > 0);
  assert.equal(result.results[2].status, 'compared'); assert.ok(result.results[2].comparison.metrics.Life.candidate.value > after.Life);
  const exported = await call('foundation_export_build', { snapshot_id: candidate.snapshot.id });
  const reloaded = await call('foundation_import_build', { xml: exported.xml, source: 'jewel-reloaded' });
  assert.equal((await call('foundation_evaluate', { snapshot_id: reloaded.id, fields: ['Life'] })).metrics.Life.value, after.Life);
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('foundation jewel comparison passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await client.stop(); await rm(dir, { recursive: true, force: true }); }
