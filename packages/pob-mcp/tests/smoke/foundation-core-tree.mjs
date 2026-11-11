import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { openPoBEngine } from '../../build/adapters/pob/engine.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { smokePoBSrc } from './pobSource.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-core-tree-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
const client = new PoBLuaApiClient({ cwd: options.cwd, cmd: options.command, args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
try {
  await client.start(); await client.newBuild({ className: 'Witch', treeVersion: '3_29' }); await client.setLevel(90);
  const search = await client.searchNodes({ keyword: 'Life Mastery', nodeType: 'mastery', maxResults: 100, includeAllocated: false });
  const mastery = search.nodes.find(node => node.id === 4139); assert.ok(mastery?.pathNodes?.length);
  const tree = await client.getTree();
  await client.setTree({ ...tree, nodes: [...tree.nodes, ...mastery.pathNodes], masteryEffects: { 4139: 47642 } });
  const { xml } = await client.unchangedItemsSnapshot();
  await client.setTree({ ...await client.getTree(), masteryEffects: { 4139: 31822 } });
  const expected = await client.getStats(['Life']); await client.stop();
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const parent = await foundation.importBuild(xml, 'mastery-oracle');
  const child = await foundation.deriveMasteries(parent.id, { 4139: 31822 }, true);
  assert.equal((await foundation.inspect(child.id, ['tree'])).data.tree.masteryEffects['4139'], 31822);
  assert.equal((await foundation.inspect(parent.id, ['tree'])).data.tree.masteryEffects['4139'], 47642);
  assert.ok(Math.abs((await foundation.evaluate(child.id, ['Life'])).metrics.Life.value - expected.Life) < 0.01);
  assert.equal(await foundation.exportBuild(parent.id), xml);
  console.log('core tree/mastery derivation, reload and direct PoB oracle passed');
} finally { await client.stop(); await rm(dir, { recursive: true, force: true }); }
