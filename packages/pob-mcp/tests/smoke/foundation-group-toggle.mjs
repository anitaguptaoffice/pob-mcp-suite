import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-group-toggle-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
const client = new PoBLuaApiClient({ cwd: options.cwd, cmd: options.command, args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
try {
  await client.start(); await client.newBuild({ className: 'Witch' });
  await client.createSocketGroup({ label: 'main', slot: 'Helmet', includeInFullDPS: true });
  await client.addGem({ groupIndex: 1, gemName: 'Arc', level: 20 });
  await client.createSocketGroup({ label: 'other', slot: 'Gloves', includeInFullDPS: true });
  await client.addGem({ groupIndex: 2, gemName: 'Fireball', level: 20 });
  const xml = await client.exportBuildXml(); await client.stop();
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const parent = await foundation.importBuild(xml, 'toggle-fixture');
  const before = await foundation.inspect(parent.id, ['skills']);
  const baseline = await foundation.evaluate(parent.id, ['FullDPS']);
  const child = await foundation.deriveSkillGroupEnabled(parent.id, 2, false);
  const after = await foundation.inspect(child.id, ['skills']);
  assert.equal(after.data.skills.groups[1].enabled, false);
  assert.deepEqual(after.data.skills.groups[0], before.data.skills.groups[0]);
  const changed = await foundation.evaluate(child.id, ['FullDPS']);
  assert.equal(baseline.metrics.FullDPS.status, 'available'); assert.equal(changed.metrics.FullDPS.status, 'available');
  assert.ok(baseline.stats.FullDPS > changed.stats.FullDPS && changed.stats.FullDPS > 0);
  assert.deepEqual((await foundation.inspect(parent.id, ['skills'])).data.skills, before.data.skills);
  const restored = await foundation.deriveSkillGroupEnabled(child.id, 2, true);
  assert.deepEqual((await foundation.inspect(restored.id, ['skills'])).data.skills, before.data.skills);
  const disabledMain = await foundation.deriveSkillGroupEnabled(parent.id, 1, false);
  assert.equal((await foundation.inspect(disabledMain.id, ['skills'])).data.skills.groups[0].enabled, false);
  await assert.rejects(foundation.deriveSkillGroupEnabled(parent.id, 99, false), /Skill group not found/);
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: options.adapterPath });
  mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'group-toggle-smoke', version: '1' } });
    mcp.notify('notifications/initialized', {});
    const response = await mcp.request('tools/call', { name: 'foundation_derive_skill_group_enabled', arguments: { snapshot_id: parent.id, group_index: 2, enabled: false, trial: true } });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    const trial = JSON.parse(response.result.content[0].text); assert.equal(trial.parentId, parent.id); assert.equal(trial.retention.kind, 'trial');
    const result = await mcp.request('tools/call', { name: 'foundation_inspect', arguments: { snapshot_id: trial.id, sections: ['skills'] } });
    assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
    assert.equal(JSON.parse(result.result.content[0].text).data.skills.groups[1].enabled, false);
    mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  } finally { if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; } }
  console.log('foundation group toggle passed');
} finally { await client.stop(); await rm(dir, { recursive: true, force: true }); }
