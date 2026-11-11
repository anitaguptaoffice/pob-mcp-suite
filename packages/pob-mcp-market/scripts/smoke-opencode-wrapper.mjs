import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

// OpenCode v2 connection check using an isolated temporary service and config.
// This does not exercise a model session or the user's installed configuration.
const runFile = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'pob-opencode-smoke-'));
const workspace = join(dir, 'workspace'), builds = join(dir, 'builds');
const env = { ...process.env, POE_SESSION_ID: '', XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const executable = process.env.OPENCODE_BIN || 'opencode';
const wrapper = resolve('pob-docker-mcp/scripts/pob-mcp-docker.sh');
const image = process.env.POB_DOCKER_IMAGE || 'pob-mcp-suite:foundation-client-local';
const call = (...args) => runFile(executable, args, { cwd: workspace, env, timeout: 45_000, maxBuffer: 1024 * 1024 });
const listener = createServer();
await new Promise((resolveListen, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolveListen); });
const port = listener.address().port;
await new Promise((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()));
let serviceStarted = false;
try {
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(builds, { recursive: true })]);
  const dockerUser = process.platform === 'linux' && process.getuid && process.getgid ? ['--env', `POB_DOCKER_USER=${process.getuid()}:${process.getgid()}`] : [];
  await call('mcp', 'add', '--env', `POB_BUILDS_DIR=${builds}`, '--env', `POB_DOCKER_IMAGE=${image}`, '--env', 'POB_FOUNDATION_ENABLED=true', '--env', 'POB_LEGACY_ENABLED=false', '--env', 'POB_LUA_ENABLED=true', '--env', 'POB_CMD=luajit', '--env', 'POE_TRADE_ENABLED=false', ...dockerUser, 'pob_foundation', '--', wrapper);
  await call('service', 'set', 'port', String(port));
  // Starting the private managed service initializes this location; reload then
  // applies its project configuration before querying connection status.
  try { await call('mcp', 'list'); } finally { serviceStarted = true; }
  await call('reload');
  let stdout = '';
  const deadline = Date.now() + 15_000;
  do {
    stdout = (await call('mcp', 'list')).stdout;
    if (/pob_foundation\s+connected/.test(stdout)) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  } while (Date.now() < deadline);
  assert.match(stdout, /pob_foundation\s+connected/);
  console.log('OpenCode isolated MCP connection passed');
} finally {
  if (serviceStarted) {
    const status = await call('service', 'status').catch(() => null);
    if (status?.stdout.trim() === `http://127.0.0.1:${port}`) await call('service', 'stop');
  }
  await rm(dir, { recursive: true, force: true });
}
