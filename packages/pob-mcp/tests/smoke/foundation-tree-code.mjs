import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-tree-code-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  const xml = await readFile(resolve('tests/fixtures/cluster-toxic-rain.xml'), 'utf8');
  const url = xml.match(/https:\/\/www\.pathofexile\.com\/passive-skill-tree\/[A-Za-z0-9_=-]+/)?.[0];
  assert.ok(url);
  const code = url.split('/').at(-1);
  await client.start(); await client.loadBuildXml(xml);
  const before = await client.getTree();
  for (const input of [url, code]) await assert.rejects(client.importCode(input), /decode import code/);
  assert.deepEqual(await client.getTree(), before);
  await client.stop();

  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tree-code-smoke', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const call = async (name, args) => {
    const response = await mcp.request('tools/call', { name, arguments: args });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const parent = await call('foundation_import_build', { xml, source: 'tree-code-fixture' });
  const initial = await call('foundation_list_snapshots', {});
  for (const input of [url, code]) {
    const result = await mcp.request('tools/call', { name: 'foundation_import_code', arguments: { code: input } });
    assert.ok(result.error || result.result?.isError, JSON.stringify(result));
  }
  assert.deepEqual(await call('foundation_list_snapshots', {}), initial);
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('official passive tree code boundary passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await client.stop(); await rm(dir, { recursive: true, force: true });
}
