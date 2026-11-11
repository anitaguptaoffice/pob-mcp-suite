// The server has no degraded mode: it must refuse to start without a usable
// Path of Building checkout and LuaJIT interpreter, and start normally with both.
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';
import { smokePoBSrc } from './pobSource.mjs';

async function expectStartupFailure(env, pattern) {
  const server = startMcpServer(env);
  let stderr = '';
  server.child.stderr.on('data', chunk => { stderr += chunk; });
  server.child.stdin.end();
  assert.notEqual((await once(server.child, 'exit'))[0], 0, 'server must exit when the engine is unusable');
  assert.match(stderr, pattern);
}

const dir = await mkdtemp(join(tmpdir(), 'pob-requirements-'));
try {
  await expectStartupFailure({
    POB_PATH: join(dir, 'missing-engine'),
    POB_DIRECTORY: dir,
    POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots'),
  }, /Path of Building engine not found/);

  await expectStartupFailure({
    POB_PATH: smokePoBSrc(),
    POB_CMD: join(dir, 'missing-luajit'),
    POB_DIRECTORY: dir,
    POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots'),
  }, /PoB executable not found/);

  const server = startMcpServer({
    POB_DIRECTORY: dir,
    POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots'),
    POE_TRADE_ENABLED: 'false',
  });
  server.child.stderr.on('data', () => {});
  const initialized = await server.request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'requirements', version: '1' },
  });
  assert.ok(initialized.result);
  assert.equal(initialized.result.capabilities.resources, undefined, 'server must not advertise an unsupported resources capability');
  server.notify('notifications/initialized', {});
  const tools = await server.request('tools/list', {});
  assert.ok(tools.result.tools.some(tool => tool.name === 'foundation_import_build'));
  server.child.stdin.end();
  assert.equal((await once(server.child, 'exit'))[0], 0);
  console.log('startup requires a usable PoB engine and LuaJIT');
} finally {
  await rm(dir, { recursive: true, force: true });
}
