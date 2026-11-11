import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-gem-job-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  await client.start(); await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'));
  const group = await client.createSocketGroup({ label: 'poison-minion', slot: 'Helmet' });
  await client.addGem({ groupIndex: group.index, gemName: 'Summon Raging Spirit', level: 20 });
  await client.addGem({ groupIndex: group.index, gemName: 'Minion Damage Support', level: 20 });
  await client.setMainSelection({ mainSocketGroup: group.index });
  assert.ok((await client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' })).applied.customMods);
  const baseline = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
  assert.ok(baseline.MinionCombinedDPS > baseline.MinionTotalDPS && baseline.MinionTotalDPS > 0);
  const { xml } = await client.unchangedItemsSnapshot(); await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gem-setup-job-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response)); return JSON.parse(response.result.content[0].text); };
  const parent = await call('foundation_import_build', { xml, source: 'gem-job-fixture' });
  const submitted = await call('submit_snapshot_gem_setups', { snapshot_id: parent.id, group_index: group.index, setups: [
    { name: 'current', gems: [{ gemName: 'Summon Raging Spirit' }, { gemName: 'Minion Damage Support' }] },
    { name: 'speed', gems: [{ gemName: 'Summon Raging Spirit' }, { gemName: 'Minion Speed Support' }] },
    { name: 'invalid', gems: [{ gemName: 'Summon Raging Spirit' }, { gemName: 'No Such Gem Fixture' }] },
  ] });
  assert.equal(submitted.setupCount, 3); assert.ok(submitted.jobId);
  const deadline = Date.now() + 240000; let summary;
  do { summary = await call('summarize_snapshot_gem_setups', { job_id: submitted.jobId }); if (['completed', 'failed', 'cancelled', 'interrupted'].includes(summary.jobStatus)) break; await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
  assert.equal(summary.jobStatus, 'completed'); assert.equal(summary.status, 'partial');
  assert.deepEqual(summary.results.map(result => result.name), ['current', 'speed', 'invalid']);
  assert.equal(summary.results[0].status, 'ok', JSON.stringify(summary.results[0])); assert.equal(summary.results[1].status, 'ok', JSON.stringify(summary.results[1]));
  assert.equal(summary.results[2].status, 'failed'); assert.match(summary.results[2].reason, /unrecognized gem/);
  assert.equal(summary.results[0].metrics.MinionCombinedDPS.delta, 0);
  assert.equal(summary.baseline.metrics.MinionCombinedDPS.value, baseline.MinionCombinedDPS);
  const measured = await call('foundation_evaluate', { snapshot_id: summary.results[1].snapshotId, fields: ['MinionCombinedDPS'] });
  assert.equal(summary.results[1].metrics.MinionCombinedDPS.candidate.value, measured.metrics.MinionCombinedDPS.value);
  assert.equal((await call('foundation_read_snapshot', { snapshot_id: summary.results[1].snapshotId })).parentId, parent.id);
  assert.equal((await call('foundation_snapshot_retention', { snapshot_id: summary.results[1].snapshotId })).kind, 'trial');
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('foundation gem setup job passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await client.stop(); await rm(dir, { recursive: true, force: true });
}
