import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-mastery-job-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  await client.start(); await client.newBuild({ className: 'Witch' });
  await client.setTree({ classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
  const initial = await client.getTree();
  const mastery = (await client.searchNodes({ keyword: 'Life Mastery', nodeType: 'mastery', maxResults: 100, includeAllocated: false })).nodes.find(node => node.id === 4139);
  assert.ok(mastery?.pathNodes?.length); await client.setLevel(90);
  await client.setTree({ ...initial, nodes: [...initial.nodes, ...mastery.pathNodes], masteryEffects: { 4139: 47642 } });
  const xml = await client.exportBuildXml(); await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mastery-job-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const result = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!result.error && !result.result?.isError, JSON.stringify(result)); return JSON.parse(result.result.content[0].text); };
  const parent = await call('foundation_import_build', { xml, source: 'mastery-job-fixture' });
  const submitted = await call('submit_snapshot_mastery_ranking', { snapshot_id: parent.id, metric: 'Life' });
  assert.ok(submitted.jobId); assert.ok(submitted.totalCandidates > 1);
  const deadline = Date.now() + 240000;
  let summary;
  do {
    summary = await call('summarize_snapshot_mastery_ranking', { job_id: submitted.jobId, limit: 1 });
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(summary.jobStatus)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  assert.equal(summary.jobStatus, 'completed'); assert.equal(summary.status, 'complete');
  assert.equal(summary.includeCurrent, false); assert.deepEqual(summary.unknownCurrentNodes, []);
  assert.equal(summary.totalDiscovered, submitted.totalCandidates + 1);
  assert.equal(summary.totalCandidates, submitted.totalCandidates); assert.equal(summary.totalRanked, submitted.totalCandidates);
  assert.equal(summary.ranked.length, 1); assert.equal(summary.nextRankedOffset, 1); assert.equal(summary.nextResultsOffset, 1);
  const next = await call('summarize_snapshot_mastery_ranking', { job_id: submitted.jobId, offset: 1, limit: 1 });
  assert.notEqual(next.ranked[0].effectId, summary.ranked[0].effectId);
  const candidate = await call('foundation_read_snapshot', { snapshot_id: summary.results[0].snapshotId });
  assert.equal(candidate.parentId, parent.id);
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('foundation mastery ranking job passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await client.stop(); await rm(dir, { recursive: true, force: true });
}
