import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-specs-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
const client = new PoBLuaApiClient({ cwd: options.cwd, cmd: options.command, args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
try {
  await client.start(); await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'));
  const original = await client.getTree();
  await client.createSpec({ title: 'Alternative', copyFrom: 1, activate: true });
  const found = await client.searchNodes({ keyword: 'life', nodeType: 'notable', maxResults: 30 });
  const node = found.nodes.find(candidate => !candidate.isBlighted && Array.isArray(candidate.pathNodes) && candidate.pathNodes.length > 0 && candidate.pathNodes.includes(candidate.id));
  assert.ok(node, 'fixture requires a reachable notable');
  await client.updateTreeDelta({ addNodes: node.pathNodes });
  const alternative = await client.getTree();
  assert.ok(node.pathNodes.every(id => alternative.nodes.includes(id)));
  await client.selectSpec(1);
  const xml = await client.exportBuildXml(); await client.stop();
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const parent = await foundation.importBuild(xml, 'specs-fixture');
  const catalog = await foundation.specs(parent.id);
  assert.equal(catalog.activeSpec, 1); assert.equal(catalog.specs.length, 2); assert.equal(catalog.specs[1].title, 'Alternative');
  const child = await foundation.deriveSpec(parent.id, 2);
  assert.equal(child.parentId, parent.id); assert.equal((await foundation.specs(child.id)).activeSpec, 2);
  const selected = (await foundation.inspect(child.id, ['tree'])).data.tree;
  assert.deepEqual(selected, alternative);
  const restored = await foundation.deriveSpec(child.id, 1);
  assert.deepEqual((await foundation.inspect(restored.id, ['tree'])).data.tree, original);
  assert.equal((await foundation.specs(parent.id)).activeSpec, 1);
  await assert.rejects(foundation.deriveSpec(parent.id, 99), /Passive spec not found/);
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: options.adapterPath });
  mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'spec-smoke', version: '1' } });
    mcp.notify('notifications/initialized', {});
    const listing = await mcp.request('tools/call', { name: 'foundation_specs', arguments: { snapshot_id: parent.id } });
    assert.ok(!listing.error && !listing.result?.isError, JSON.stringify(listing));
    assert.equal(JSON.parse(listing.result.content[0].text).specs.length, 2);
    const response = await mcp.request('tools/call', { name: 'foundation_derive_spec', arguments: { snapshot_id: parent.id, spec_index: 2, trial: true } });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    const trial = JSON.parse(response.result.content[0].text); assert.equal(trial.parentId, parent.id); assert.equal(trial.retention.kind, 'trial');
    mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  } finally { if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; } }
  console.log('foundation passive specs passed');
} finally { await client.stop(); await rm(dir, { recursive: true, force: true }); }
