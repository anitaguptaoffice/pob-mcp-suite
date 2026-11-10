import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { gearedBuildXml } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-config-preset-'));
let child;
async function start() {
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, '.snapshots'), POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'preset-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  const close = async () => { child.stdin.end(); assert.equal((await exited)[0], 0); };
  return { mcp, call, close };
}
try {
  let server = await start();
  const xml = await readFile(gearedBuildXml, 'utf8');
  const parent = await server.call('foundation_import_build', { xml, source: 'preset-fixture' });
  const before = (await server.call('foundation_inspect', { snapshot_id: parent.id, sections: ['config'] })).data.config;
  assert.equal(typeof before.brandAttachedToEnemy, 'boolean');
  const saved = await server.call('save_snapshot_config_preset', { snapshot_id: parent.id, name: 'boss' });
  assert.equal(saved.keyCount, Object.keys(before).length);
  const conflict = await server.mcp.request('tools/call', { name: 'save_snapshot_config_preset', arguments: { snapshot_id: parent.id, name: 'boss' } });
  assert.equal(conflict.result.isError, true);
  const otherBoss = before.enemyIsBoss === 'Pinnacle' ? 'Boss' : 'Pinnacle';
  const target = await server.call('foundation_derive_config', { snapshot_id: parent.id, config: { enemyIsBoss: otherBoss } });
  await mkdir(join(dir, '.pob-mcp-presets'));
  await writeFile(join(dir, '.pob-mcp-presets', 'bad.json'), JSON.stringify({ brandAttachedToEnemy: !before.brandAttachedToEnemy }));
  await server.close(); server = await start();
  const listed = await server.call('list_local_config_presets', {});
  assert.deepEqual(listed.presets.map(item => item.name), ['bad', 'boss']);
  const restored = await server.call('read_local_config_preset', { name: 'boss' });
  assert.deepEqual(restored.preset.config, before); assert.equal(restored.preset.sourceSnapshotId, parent.id);
  const applied = await server.call('apply_snapshot_config_preset', { snapshot_id: target.id, name: 'boss' });
  assert.equal(applied.snapshot.parentId, target.id); assert.ok(applied.changedKeys.includes('enemyIsBoss'));
  assert.ok(!applied.changedKeys.includes('brandAttachedToEnemy'));
  const after = (await server.call('foundation_inspect', { snapshot_id: applied.snapshot.id, sections: ['config'] })).data.config;
  for (const [key, value] of Object.entries(before)) assert.deepEqual(after[key], value, key);
  const idsBefore = (await server.call('foundation_list_snapshots', { limit: 50 })).snapshots.map(item => item.id).sort();
  const rejected = await server.mcp.request('tools/call', { name: 'apply_snapshot_config_preset', arguments: { snapshot_id: parent.id, name: 'bad' } });
  assert.equal(rejected.result.isError, true); assert.match(rejected.result.content[0].text, /rejected/);
  assert.deepEqual((await server.call('foundation_list_snapshots', { limit: 50 })).snapshots.map(item => item.id).sort(), idsBefore);
  assert.equal((await server.call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  await server.close(); console.log('foundation config presets passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
