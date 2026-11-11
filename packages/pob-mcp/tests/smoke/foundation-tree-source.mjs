import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/adapters/pob/engine.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';

// Never modify the installed source. This disposable checkout exercises both
// data identity and actual tree contents on successive engine instances.
const dir = await mkdtemp(join(tmpdir(), 'pob-tree-source-'));
try {
  const checkout = join(dir, 'checkout');
  execFileSync('cp', ['-a', '--reflink=auto', dirname(smokePoBSrc()), checkout]);
  const src = join(checkout, 'src');
  const treeFile = join(src, 'TreeData', '3_13', 'tree.lua');
  const options = { cwd: src, command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
  const foundation = new BuildFoundation(new SnapshotStore(join(dir, 'snapshots')), () => openPoBEngine(options));
  const xml = await readFile(gearedBuildXml, 'utf8');
  const old = await foundation.importBuild(xml, 'tree-source-before');
  const before = await foundation.searchTree(old.id, "Arcanist's Dominion", { includeAllocated: true });
  assert.equal(before.treeVersion, '3_13');
  assert.ok(before.nodes.some(node => node.name === "Arcanist's Dominion"));

  const active = await openPoBEngine(options);
  try {
    const contents = await readFile(treeFile, 'utf8');
    const original = '["name"]= "Arcanist\'s Dominion"';
    const replacement = '["name"]= "Source Refresh Test"';
    assert.equal(contents.split(original).length, 2);
    await writeFile(treeFile, contents.replace(original, replacement));
    await assert.rejects(active.verifyIdentity(), /changed during operation/);
  } finally { await active.close(); }

  const recalculated = await foundation.searchTree(old.id, 'Source Refresh Test', { includeAllocated: true });
  assert.ok(recalculated.nodes.some(node => node.name === 'Source Refresh Test'));
  assert.notEqual(recalculated.identity.dataVersion, old.dataVersion);
  assert.ok(recalculated.warnings.some(warning => warning.includes('Snapshot creation dataVersion differs')));
  assert.deepEqual(await foundation.readSnapshot(old.id), (({ xml, ...metadata }) => metadata)(old));
  assert.equal(await foundation.exportBuild(old.id), xml);
  const updated = await foundation.importBuild(xml, 'tree-source-after');
  assert.notEqual(updated.dataVersion, old.dataVersion);
  const after = await foundation.searchTree(updated.id, 'Source Refresh Test', { includeAllocated: true });
  assert.equal(after.treeVersion, '3_13');
  assert.ok(after.nodes.some(node => node.name === 'Source Refresh Test'));
  await foundation.createBuild('Witch', undefined, '3_13');
  await assert.rejects(foundation.createBuild('Witch', undefined, '3_999'), /3_999|tree|version/i);
  console.log('PoB tree source reload and snapshot identity passed');
} finally { await rm(dir, { recursive: true, force: true }); }
