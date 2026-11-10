import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
import { once } from 'node:events';

const dir = await mkdtemp(join(tmpdir(), 'pob-selection-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
const client = new PoBLuaApiClient({ cwd: options.cwd, cmd: options.command, args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
try {
  await client.start();
  await client.newBuild({ className: 'Witch' });
  await client.createSocketGroup({ label: 'multipart', slot: 'Helmet' });
  await client.addGem({ groupIndex: 1, gemName: 'Arc', level: 20 });
  await client.addGem({ groupIndex: 1, gemName: 'Ball Lightning', level: 20 });
  await client.setMainSelection({ mainSocketGroup: 1, mainActiveSkill: 2, skillPart: 1 });
  const xml = await client.exportBuildXml();
  await client.stop();
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const parent = await foundation.importBuild(xml, 'multipart-fixture');
  const selection = { mainSocketGroup: 1, mainActiveSkill: 2 };
  const one = await foundation.evaluate(parent.id, ['TotalDPS'], { selection: { ...selection, skillPart: 1 } });
  const two = await foundation.evaluate(parent.id, ['TotalDPS'], { selection: { ...selection, skillPart: 2 }, config: { enemyIsBoss: 'Pinnacle' } });
  assert.equal(one.context.skills.groups[0].selectedSkillPart, 1);
  assert.equal(two.context.skills.groups[0].selectedSkillPart, 2);
  assert.equal(two.context.config.enemyIsBoss, 'Pinnacle');
  const sameEnemyOne = await foundation.evaluate(parent.id, ['TotalDPS'], { selection: { ...selection, skillPart: 1 }, config: { enemyIsBoss: 'Pinnacle' } });
  assert.ok(sameEnemyOne.stats.TotalDPS > 0 && two.stats.TotalDPS > sameEnemyOne.stats.TotalDPS);
  await assert.rejects(foundation.evaluate(parent.id, ['TotalDPS'], { selection: { ...selection, skillPart: 3 } }), /invalid skillPart/);
  assert.equal(await foundation.exportBuild(parent.id), xml);
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: options.adapterPath });
  mcp.child.stderr.on('data', () => {});
  const exited = once(mcp.child, 'exit');
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selection-smoke', version: '1' } });
    mcp.notify('notifications/initialized', {});
    const response = await mcp.request('tools/call', { name: 'foundation_evaluate', arguments: { snapshot_id: parent.id, fields: ['TotalDPS'], selection: { ...selection, skillPart: 2 }, config: { enemyIsBoss: 'Pinnacle' } } });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.context.skills.groups[0].selectedSkillPart, 2);
    assert.equal(result.stats.TotalDPS, two.stats.TotalDPS);
    mcp.child.stdin.end();
    assert.equal((await exited)[0], 0);
  } finally {
    if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; }
  }
  console.log('foundation skill selection and config passed');
} finally { await client.stop(); await rm(dir, { recursive: true, force: true }); }
