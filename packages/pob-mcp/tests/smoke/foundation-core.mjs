// Small PR gate: direct PoB is the oracle; exercise the public MCP lifecycle.
import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { BuildXml } from '../../build/utils/buildXml.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-core-'));
const snapshots = join(dir, 'snapshots');
const fields = ['Life', 'MinionTotalDPS', 'MinionCombinedDPS'];
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD,
  args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let mcp;
const start = async () => {
  mcp = startMcpServer({ POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: snapshots });
  mcp.child.stderr.on('data', () => {});
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'core', version: '1' } });
  mcp.notify('notifications/initialized', {});
};
const call = async (name, args) => {
  const response = await mcp.request('tools/call', { name, arguments: args });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
const stop = async () => { const exited = once(mcp.child, 'exit'); mcp.child.stdin.end(); assert.equal((await exited)[0], 0); };
const match = (result, expected) => {
  for (const field of fields) assert.ok(Math.abs(result.metrics[field].value - expected[field]) < 0.01, `${field} differs from direct PoB`);
};
try {
  await client.start();
  await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'));
  const group = await client.createSocketGroup({ label: 'poison-minion', slot: 'Helmet' });
  await client.addGem({ groupIndex: group.index, gemName: 'Summon Raging Spirit', level: 20 });
  await client.setMainSelection({ mainSocketGroup: group.index });
  assert.ok((await client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' })).applied.customMods);
  const expected = await client.getStats(fields);
  assert.ok(expected.MinionCombinedDPS > expected.MinionTotalDPS && expected.MinionTotalDPS > 0);
  const { xml } = await client.unchangedItemsSnapshot();
  await client.setLevel(70);
  const expectedChanged = await client.getStats(fields);
  await client.stop();
  const store = new SnapshotStore(snapshots);
  const old = await store.create({ xml, source: 'historical-creation', parentId: null,
    engineVersion: 'old', dataVersion: 'old', adapterVersion: 'old', runtimeVersion: 'old', executableVersion: 'old' });
  const originalBytes = await readFile(join(snapshots, `${old.id}.json`), 'utf8');
  await start();
  const imported = await call('foundation_import_build', { xml, source: 'core-fixture' });
  const code = await call('foundation_import_code', { code: deflateSync(xml).toString('base64url') });
  match(await call('foundation_evaluate', { snapshot_id: code.id, fields }), expected);
  const recalculated = await call('foundation_evaluate', { snapshot_id: old.id, fields });
  match(recalculated, expected);
  assert.notEqual(recalculated.identity.dataVersion, 'old');
  const child = await call('foundation_derive_level', { snapshot_id: old.id, level: 70 });
  assert.equal(child.parentId, old.id);
  assert.equal(child.dataVersion, recalculated.identity.dataVersion);
  const changed = await call('foundation_evaluate', { snapshot_id: child.id, fields }); match(changed, expectedChanged);
  const exported = await call('foundation_export_build', { snapshot_id: child.id });
  await call('foundation_save_file', { snapshot_id: child.id, build_name: 'saved' });
  assert.equal(await readFile(join(dir, 'saved.xml'), 'utf8'), exported.xml);
  assert.equal((await call('foundation_export_build', { snapshot_id: imported.id })).xml, xml);
  assert.equal(await readFile(join(snapshots, `${old.id}.json`), 'utf8'), originalBytes);
  const invalid = new BuildXml(xml); invalid.setTree([...invalid.getAllocatedNodes(), '99999999']);
  const rejected = await mcp.request('tools/call', { name: 'foundation_import_build', arguments: { xml: invalid.toString(), source: 'dropped-node' } });
  assert.ok(rejected.result?.isError && rejected.result.content[0].text.includes('dropped'), JSON.stringify(rejected));
  await stop(); await start();
  const reloaded = await call('foundation_import_file', { build_name: 'saved' });
  match(await call('foundation_evaluate', { snapshot_id: reloaded.id, fields }), expectedChanged);
  await stop();
  console.log('core MCP import, poison DPS, old provenance, derive, export, restart/reload and load-loss rejection passed');
} finally {
  if (mcp && mcp.child.exitCode === null && mcp.child.signalCode === null) { const exited = once(mcp.child, 'exit'); mcp.child.kill('SIGKILL'); await exited; }
  await client.stop(); await rm(dir, { recursive: true, force: true });
}
