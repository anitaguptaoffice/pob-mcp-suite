import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = await mkdtemp(join(tmpdir(), 'pob-sdk-client-'));
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('build/index.js')],
  env: { ...process.env, POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'pob-foundation-sdk-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const listing = await client.listTools();
  assert.ok(listing.tools.some(tool => tool.name === 'foundation_import_build'));
  const xml = await readFile(resolve('example-build.xml'), 'utf8');
  const imported = await client.callTool({ name: 'foundation_import_build', arguments: { xml, source: 'official-mcp-sdk' } });
  assert.notEqual(imported.isError, true);
  const snapshot = JSON.parse(imported.content[0].text);
  const evaluated = await client.callTool({ name: 'foundation_evaluate', arguments: { snapshot_id: snapshot.id, fields: ['Life'] } });
  assert.notEqual(evaluated.isError, true);
  assert.ok(JSON.parse(evaluated.content[0].text).metrics.Life.value > 0);
  console.log('foundation official MCP SDK client passed');
} finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
