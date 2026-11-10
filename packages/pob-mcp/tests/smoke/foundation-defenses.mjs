import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { defenseFields } from '../../build/features/defenses/tool.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-defenses-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  await client.start(); await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'));
  const ci = (await client.searchNodes({ keyword: 'Chaos Inoculation', nodeType: 'keystone', maxResults: 30, includeAllocated: true })).nodes.find(node => node.name === 'Chaos Inoculation');
  assert.ok(ci, 'fixture tree must contain Chaos Inoculation');
  if (!ci.allocated) {
    const path = await client.queryTreePaths({ targetNodeId: ci.id });
    assert.equal(path.node.status, 'reachable'); await client.updateTreeDelta({ addNodes: path.node.pathNodes });
  }
  const xml = await client.exportBuildXml();
  const native = await client.getStats([...defenseFields]);
  assert.equal(native.Life, 1); assert.ok(native.EnergyShield > 0);
  await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'defenses-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  const parent = await call('foundation_import_build', { xml, source: 'ci-defense-fixture' });
  const report = await call('inspect_snapshot_defenses', { snapshot_id: parent.id });
  assert.equal(report.groups.pools.Life.value, 1); assert.equal(report.groups.pools.EnergyShield.value, native.EnergyShield);
  for (const group of Object.values(report.groups)) for (const [field, metric] of Object.entries(group)) {
    if (typeof native[field] === 'number' && Number.isFinite(native[field])) { assert.equal(metric.status, 'available', field); assert.equal(metric.value, native[field], field); }
    else { assert.equal(metric.status, 'unknown', field); assert.equal(metric.value, null, field); }
  }
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('foundation defenses passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await client.stop(); await rm(dir, { recursive: true, force: true }); }
