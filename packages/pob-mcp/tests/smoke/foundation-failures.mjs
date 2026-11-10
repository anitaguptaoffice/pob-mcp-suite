import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { smokePoBSrc } from './pobSource.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-failure-'));
const oldFailure = process.env.POB_TEST_FAILURE;
const oldCommand = process.env.POB_TEST_REAL_CMD;
const oldTrace = process.env.POB_TEST_TRACE;
try {
  process.env.POB_TEST_REAL_CMD = process.env.POB_CMD || 'luajit';
  const store = new SnapshotStore(dir);
  const xml = await readFile(resolve('example-build.xml'), 'utf8');
  const parent = await store.create({ xml, source: 'fault-fixture', parentId: null, engineVersion: null, adapterVersion: null, dataVersion: null });
  const options = { cwd: smokePoBSrc(), command: resolve('tests/smoke/engine-fault-proxy.mjs'), adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 5000 };
  for (const mode of ['crash', 'timeout']) {
    process.env.POB_TEST_FAILURE = mode;
    process.env.POB_TEST_TRACE = join(dir, `${mode}.trace`);
    const foundation = new BuildFoundation(store, () => openPoBEngine(options));
    await assert.rejects(foundation.deriveLevel(parent.id, 50), mode === 'crash' ? /exited|EPIPE/i : /Timed out/i);
    assert.equal(await readFile(process.env.POB_TEST_TRACE, 'utf8'), 'capture\n');
    assert.equal((await store.read(parent.id)).xml, xml);
    assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.json')), [`${parent.id}.json`]);
  }
  delete process.env.POB_TEST_FAILURE;
  const normal = new BuildFoundation(store, () => openPoBEngine({ ...options, command: process.env.POB_CMD, timeoutMs: 60000 }));
  assert.ok((await normal.evaluate(parent.id, ['Life'])).metrics.Life.value > 0);
  console.log('foundation real-engine crash and timeout isolation passed');
} finally {
  if (oldFailure === undefined) delete process.env.POB_TEST_FAILURE; else process.env.POB_TEST_FAILURE = oldFailure;
  if (oldCommand === undefined) delete process.env.POB_TEST_REAL_CMD; else process.env.POB_TEST_REAL_CMD = oldCommand;
  if (oldTrace === undefined) delete process.env.POB_TEST_TRACE; else process.env.POB_TEST_TRACE = oldTrace;
  await rm(dir, { recursive: true, force: true });
}
