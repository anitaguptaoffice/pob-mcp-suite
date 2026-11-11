import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { JobStore } from '../../build/foundation/jobStore.js';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-retention-smoke-'));
const clients = [];
const store = new SnapshotStore(dir);
const input = { xml: '<build/>', source: 'retention-smoke', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null };
async function start() {
  const c = startMcpServer({ POB_SNAPSHOT_DIRECTORY: dir, POB_DIRECTORY: dir });
  c.child.stderr.on('data', () => {});
  clients.push(c.child);
  await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'retention-smoke', version: '1' } });
  c.notify('notifications/initialized', {});
  return c;
}
async function call(c, name, args) {
  const response = await c.request('tools/call', { name, arguments: args });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
}
async function stop(c) { const exited = once(c.child, 'exit'); c.child.stdin.end(); assert.equal((await exited)[0], 0); }
try {
  const parent = await store.create(input);
  const originalNow = Date.now;
  Date.now = () => originalNow() - 8 * 24 * 60 * 60 * 1000;
  let expired, protectedJob, retainedOld;
  try {
    expired = await store.create({ ...input, source: 'expired', parentId: parent.id }, true);
    protectedJob = await store.create({ ...input, source: 'job', parentId: parent.id }, true);
    retainedOld = await store.create({ ...input, source: 'retained-old', parentId: parent.id }, true);
  } finally { Date.now = originalNow; }
  await store.retain(retainedOld.id);
  const fresh = await store.create({ ...input, source: 'fresh', parentId: parent.id }, true);
  const saved = await store.create({ ...input, source: 'saved', parentId: parent.id }, true);
  const jobs = new JobStore(join(dir, 'jobs'));
  const pending = await jobs.create(1, [{ snapshotId: protectedJob.id, fields: ['Life'] }]);
  const first = await start();
  assert.equal((await jobs.get(pending.id)).status, 'interrupted');
  await assert.rejects(store.read(expired.id), { code: 'ENOENT' });
  assert.equal((await store.read(protectedJob.id)).id, protectedJob.id);
  assert.equal((await store.read(retainedOld.id)).id, retainedOld.id);
  assert.equal((await call(first, 'foundation_snapshot_retention', { snapshot_id: fresh.id })).retained, false);
  assert.equal((await call(first, 'foundation_retain_snapshot', { snapshot_id: fresh.id })).snapshotId, fresh.id);
  assert.equal((await call(first, 'foundation_snapshot_retention', { snapshot_id: fresh.id })).retained, true);
  assert.equal((await call(first, 'foundation_save_file', { snapshot_id: saved.id, build_name: 'retained-build' })).retained, true);
  assert.equal((await call(first, 'foundation_snapshot_retention', { snapshot_id: saved.id })).retained, true);
  await stop(first);
  await jobs.create(1); // Old records may not contain recoverable input references.
  Date.now = () => originalNow() - 8 * 24 * 60 * 60 * 1000;
  let unknownJobCandidate;
  try { unknownJobCandidate = await store.create({ ...input, source: 'unknown-job', parentId: parent.id }, true); }
  finally { Date.now = originalNow; }
  const second = await start();
  assert.equal((await call(second, 'foundation_snapshot_retention', { snapshot_id: fresh.id })).retained, true);
  assert.equal((await store.read(unknownJobCandidate.id)).id, unknownJobCandidate.id);
  await stop(second);
  console.log('foundation retention startup and MCP passed');
} finally {
  for (const child of clients) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
