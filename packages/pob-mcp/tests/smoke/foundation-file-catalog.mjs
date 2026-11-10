import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-file-catalog-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, '.snapshots'), POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
const child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
try {
  const xml = await readFile(resolve('example-build.xml'), 'utf8');
  await mkdir(join(dir, 'league')); await writeFile(join(dir, 'league', 'build.xml'), xml);
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'file-catalog-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1000)); return JSON.parse(response.result.content[0].text); };
  const catalog = await call('list_local_build_files', {});
  assert.equal(catalog.complete, true); assert.deepEqual(catalog.names, [join('league', 'build.xml')]);
  const snapshot = await call('foundation_import_file', { build_name: catalog.names[0] });
  await writeFile(join(dir, 'league', 'build.xml'), '<changed/>');
  assert.equal((await call('foundation_export_build', { snapshot_id: snapshot.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('foundation file catalog passed');
} finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
