import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-runtime-isolation-'));
const loader = pathToFileURL(resolve('tests/smoke/reject-legacy-loader.mjs')).href;
const env = { NODE_OPTIONS: `--experimental-loader=${loader}`, POB_LUA_ENABLED: 'false', POE_TRADE_ENABLED: 'false', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots') };
let child;
try {
  const foundation = startMcpServer({ ...env, POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false' });
  child = foundation.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  const initialized = await foundation.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'legacy-runtime-isolation', version: '1' } });
  assert.ok(initialized.result); foundation.notify('notifications/initialized', {});
  const tools = await foundation.request('tools/list', {});
  assert.ok(tools.result.tools.some(tool => tool.name === 'foundation_import_build'));
  assert.ok(!tools.result.tools.some(tool => tool.name === 'lua_load_build'));
  child.stdin.end(); assert.equal((await exited)[0], 0);
  const legacy = startMcpServer({ ...env, POB_FOUNDATION_ENABLED: 'false', POB_LEGACY_ENABLED: 'true' });
  child = legacy.child; let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  assert.notEqual((await once(child, 'exit'))[0], 0);
  assert.match(stderr, /LEGACY_RUNTIME_IMPORT_BLOCKED/);
  console.log('foundation starts without legacy runtime passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
