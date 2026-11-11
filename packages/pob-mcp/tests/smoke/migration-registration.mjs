// Compare documented replacement identifiers with the actual new MCP surface.
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-migration-registry-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'true', POE_SESSION_ID: 'fixture-not-a-real-session', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots') });
const child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'migration-registry-audit', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const reply = await mcp.request('tools/list', {});
  assert.ok(!reply.error && Array.isArray(reply.result?.tools), JSON.stringify(reply));
  const names = reply.result.tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length, 'new MCP surface must not contain duplicate names');
  const inventory = await readFile(resolve('../../docs/LEGACY_TOOL_INVENTORY.md'), 'utf8');
  const nonTools = new Set(['all_groups', 'build', 'config', 'items', 'skills', 'tree']);
  const replacements = new Map();
  const unmapped = [];
  let parsedRows = 0;
  for (const line of inventory.split('\n')) {
    const row = /^- `([^`]+)` — target: .*?; replacement: (.*?); status:/.exec(line);
    if (!row) continue;
    parsedRows++;
    let count = 0;
    for (const match of row[2].matchAll(/`([^`]+)`/g)) {
      if (nonTools.has(match[1])) continue;
      count++;
      const users = replacements.get(match[1]) ?? []; users.push(row[1]); replacements.set(match[1], users);
    }
    if (!count) unmapped.push(row[1]);
  }
  assert.equal(parsedRows, [...inventory.matchAll(/^- `([^`]+)` — target:/gm)].length, 'every inventory row must use the documented replacement and status format');
  assert.deepEqual(unmapped.sort(), ['lua_start', 'lua_stop'], 'new unregistered replacement or intentional internal-only entry must be reviewed');
  assert.ok(replacements.size > 100, 'inventory extraction must cover the documented tool mappings');
  const missing = [...replacements].filter(([name]) => !names.includes(name)).map(([name, users]) => ({ name, legacyTools: users }));
  assert.deepEqual(missing, [], `documented replacements absent from the advertised MCP surface: ${JSON.stringify(missing)}`);
  assert.ok(!names.includes('lua_load_build'), 'mutable legacy session must not be exposed');
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log(`migration registry passed: ${replacements.size} documented replacement identifiers advertised`);
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
