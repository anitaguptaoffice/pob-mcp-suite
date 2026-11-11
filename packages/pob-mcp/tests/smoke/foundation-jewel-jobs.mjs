import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-jewel-jobs-'));
let child;
async function start() {
  const mcp = startMcpServer({ POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jewel-job-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  return { call, exited, close: async () => { child.stdin.end(); assert.equal((await exited)[0], 0); } };
}
async function poll(call, jobId, predicate) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const result = await call('summarize_snapshot_jewels', { job_id: jobId });
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('jewel job did not reach expected state');
}
try {
  const xml = await readFile(resolve('tests/fixtures/cluster-toxic-rain.xml'), 'utf8');
  const jewel = 'Rarity: RARE\nTest Jewel\nCobalt Jewel\nImplicits: 0\n+50 to maximum Life';
  let server = await start(); const parent = await server.call('foundation_import_build', { xml, source: 'jewel-job-fixture' });
  const submit = async () => server.call('submit_snapshot_jewels', { snapshot_id: parent.id, socket_node_id: 34483, fields: ['Life'], candidates: [{ name: 'life', item_text: jewel }] });
  const interruptedJob = await submit(); assert.ok(interruptedJob.jobId);
  const progress = await poll(server.call, interruptedJob.jobId, result => !!result.results[0].snapshotId);
  assert.equal(progress.jobStatus, 'running'); const childId = progress.results[0].snapshotId;
  child.kill('SIGKILL'); await server.exited;
  // This is an isolated temporary store; explicit stale-lock recovery is needed after a crash.
  await rm(join(dir, '.writer.lock'));
  server = await start();
  const interrupted = await server.call('summarize_snapshot_jewels', { job_id: interruptedJob.jobId });
  assert.equal(interrupted.jobStatus, 'interrupted'); assert.equal(interrupted.results[0].snapshotId, childId);
  assert.equal((await server.call('foundation_read_snapshot', { snapshot_id: childId })).parentId, parent.id);
  const completedJob = await submit();
  const completed = await poll(server.call, completedJob.jobId, result => ['completed', 'failed', 'cancelled', 'interrupted'].includes(result.jobStatus));
  assert.equal(completed.jobStatus, 'completed'); assert.equal(completed.results[0].status, 'compared');
  assert.equal(completed.results[0].snapshotId, completed.results[0].snapshot.id);
  assert.ok(['available', 'identity_unverified'].includes(completed.results[0].comparison.metrics.Life.status));
  assert.equal((await server.call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  await server.close(); server = await start();
  const restored = await server.call('summarize_snapshot_jewels', { job_id: completedJob.jobId });
  assert.equal(restored.jobStatus, 'completed'); assert.equal(restored.results[0].snapshotId, completed.results[0].snapshotId);
  await server.close(); console.log('foundation jewel jobs passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
