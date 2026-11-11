import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-engine-status-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
async function start(env) {
  const mcp = startMcpServer({ POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua'), ...env });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'engine-status-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  return { mcp, close: async () => { child.stdin.end(); assert.equal((await exited)[0], 0); } };
}
try {
  await client.start(); const native = await client.getCapabilities(), version = await client.getVersion(); await client.stop();
  let server = await start({});
  const response = await server.mcp.request('tools/call', { name: 'inspect_pob_engine', arguments: {} });
  assert.ok(!response.result?.isError, JSON.stringify(response)); const result = JSON.parse(response.result.content[0].text);
  assert.deepEqual(result.bridge.actions, native.actions); assert.equal(result.bridge.mode, native.mode); assert.equal(result.identity.engineVersion, version.number);
  assert.ok(result.identity.adapterVersion && result.identity.dataVersion); assert.equal(result.bridge.reported, true);
  const snapshots = await server.mcp.request('tools/call', { name: 'foundation_list_snapshots', arguments: {} });
  assert.equal(JSON.parse(snapshots.result.content[0].text).snapshots.length, 0);
  await server.close(); console.log('pob engine status passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await client.stop(); await rm(dir, { recursive: true, force: true }); }
