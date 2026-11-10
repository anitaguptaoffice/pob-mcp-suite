import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-foundation-'));
const open = () => openPoBEngine({ cwd: smokePoBSrc(), command: process.env.POB_CMD,
  adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 });
try {
  const foundation = new BuildFoundation(new SnapshotStore(dir), open);
  for (const fixture of [resolve('example-build.xml'), gearedBuildXml]) {
    const xml = await readFile(fixture, 'utf8');
    const parent = await foundation.importBuild(xml, fixture);
    const fields = ['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'MinionTotalDPS'];
    const before = (await foundation.evaluate(parent.id, fields)).stats;
    const child = await foundation.deriveLevel(parent.id, 50);
    assert.equal(child.parentId, parent.id);
    assert.equal(await foundation.exportBuild(parent.id), xml);
    const after = (await foundation.evaluate(child.id, fields)).stats;
    assert.ok(Number.isFinite(before.Life) && Number.isFinite(after.Life));
    assert.notEqual(before.Life, after.Life);
    const reload = await foundation.importBuild(await foundation.exportBuild(child.id), 'reload');
    assert.deepEqual((await foundation.evaluate(reload.id, fields)).stats, after);
  }
  console.log('foundation vertical slice passed');
} finally { await rm(dir, { recursive: true, force: true }); }
