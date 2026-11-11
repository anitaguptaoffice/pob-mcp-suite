import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-item-data-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  const cases = [
    'Rarity: RARE\nWeight Test\nCitrine Amulet\nItem Level: 1\nImplicits: 0',
    'Rarity: RARE\nWeight Test\nGold Ring\nItem Level: 86\nImplicits: 0',
    'Rarity: RARE\nWeight Test\nCitrine Amulet\nImplicits: 0',
  ];
  await client.start(); await client.newBuild({ className: 'Witch' });
  const native = []; for (const item of cases) native.push(await client.getItemAffixWeight('AddedPhysicalDamage7', item));
  await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'item-data-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  for (let i = 0; i < cases.length; i++) {
    const actual = await call('inspect_pob_item_affix_weight', { mod_id: 'AddedPhysicalDamage7', item_text: cases[i] });
    for (const key of ['weight', 'base', 'modId', 'itemLevel', 'requiredItemLevel']) assert.deepEqual(actual[key], native[i][key], key);
    assert.equal(actual.itemLevelAllows, i === 0 ? false : i === 1 ? true : null);
  }
  assert.equal((await call('foundation_list_snapshots', {})).snapshots.length, 0);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('pob item data passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await client.stop(); await rm(dir, { recursive: true, force: true }); }
