import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { normalizeObservation } from '../../build/foundation/observation.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-flask-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
try {
  const fixture = await readFile(gearedBuildXml, 'utf8');
  const bridge = new PoBLuaApiClient({ cwd: options.cwd, cmd: options.command, args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
  try {
    await bridge.start(); await bridge.loadBuildXml(fixture);
    const active = await bridge.getStats(['Armour']);
    await bridge.setFlaskActive(2, false);
    const inactive = await bridge.getStats(['Armour']);
    assert.ok(active.Armour > inactive.Armour);
    const captured = await bridge.unchangedItemsSnapshot();
    await bridge.loadBuildXml(captured.xml);
    assert.equal((await bridge.getStats(['Armour'])).Armour, inactive.Armour);
  } finally { await bridge.stop(); }
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const parent = await foundation.importBuild(fixture, 'flask-fixture');
  const original = await foundation.inspect(parent.id, ['items']);
  assert.equal(original.data.items.find(item => item.slot === 'Flask 2').active, true);
  const before = await foundation.evaluate(parent.id, ['Armour']);
  const child = await foundation.deriveFlaskActive(parent.id, 2, false);
  const after = await foundation.inspect(child.id, ['items']);
  assert.equal(after.data.items.find(item => item.slot === 'Flask 2').active, false);
  const without = await foundation.evaluate(child.id, ['Armour']);
  assert.equal(before.metrics.Armour.status, 'available'); assert.equal(without.metrics.Armour.status, 'available');
  assert.ok(before.stats.Armour > without.stats.Armour);
  assert.deepEqual((await foundation.inspect(parent.id, ['items'])).data.items, original.data.items);
  const restored = await foundation.deriveFlaskActive(child.id, 2, true);
  assert.deepEqual(normalizeObservation({ items: (await foundation.inspect(restored.id, ['items'])).data.items }).items, normalizeObservation({ items: original.data.items }).items);
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: options.adapterPath });
  mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'flask-smoke', version: '1' } });
    mcp.notify('notifications/initialized', {});
    const response = await mcp.request('tools/call', { name: 'foundation_derive_flask_active', arguments: { snapshot_id: parent.id, flask_index: 2, active: false, trial: true } });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    const trial = JSON.parse(response.result.content[0].text); assert.equal(trial.parentId, parent.id); assert.equal(trial.retention.kind, 'trial');
    const result = await mcp.request('tools/call', { name: 'foundation_evaluate', arguments: { snapshot_id: trial.id, fields: ['Armour'] } });
    assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
    assert.equal(JSON.parse(result.result.content[0].text).stats.Armour, without.stats.Armour);
    mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  } finally { if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; } }
  console.log('foundation flask activation passed');
} finally { await rm(dir, { recursive: true, force: true }); }
