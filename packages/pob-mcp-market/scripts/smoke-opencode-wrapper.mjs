import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

// OpenCode v2 client test with an isolated config and a deterministic local
// model stub. It never reads the user's model credentials or configuration.
const runFile = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'pob-opencode-smoke-'));
const workspace = join(dir, 'workspace'), builds = join(dir, 'builds');
const env = { ...process.env, POE_SESSION_ID: '', XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const executable = process.env.OPENCODE_BIN || 'opencode';
const wrapper = resolve('pob-docker-mcp/scripts/pob-mcp-docker.sh');
const image = process.env.POB_DOCKER_IMAGE || 'pob-mcp-suite:local';
const call = (...args) => runFile(executable, args, { cwd: workspace, env, timeout: 45_000, maxBuffer: 1024 * 1024 });
const listener = createServer();
await new Promise((resolveListen, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolveListen); });
const port = listener.address().port;
await new Promise((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()));
let modelCalls = 0, importedId = null, calculatedLife = null;
const modelServer = createHttpServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const tools = body.tools ?? [];
    const toolName = suffix => tools.find(tool => tool.function?.name?.endsWith(suffix))?.function?.name;
    const messages = (body.messages ?? []).filter(message => message.role === 'tool');
    const toolResult = () => {
      let value = messages.at(-1)?.content;
      for (let i = 0; i < 4; i++) {
        if (typeof value === 'string') { value = JSON.parse(value); continue; }
        if (Array.isArray(value)) { value = value.find(entry => entry?.type === 'text')?.text; continue; }
        if (value && Array.isArray(value.content)) { value = value.content; continue; }
        break;
      }
      return value;
    };
    let delta, finish;
    if (modelCalls === 0) {
      const name = toolName('foundation_import_file');
      if (!name) throw new Error(`Import tool absent from model catalog: ${tools.map(tool => tool.function?.name).join(', ')}`);
      delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call_import', type: 'function', function: { name, arguments: JSON.stringify({ build_name: 'example.xml' }) } }] }; finish = 'tool_calls';
    } else if (modelCalls === 1) {
      const result = toolResult();
      importedId = typeof result?.id === 'string' && /^[a-f0-9]{64}$/.test(result.id) ? result.id : null;
      const name = toolName('foundation_evaluate');
      if (!importedId || !name) throw new Error('Import result or evaluation tool missing');
      delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call_evaluate', type: 'function', function: { name, arguments: JSON.stringify({ snapshot_id: importedId, fields: ['Life'] }) } }] }; finish = 'tool_calls';
    } else {
      const result = toolResult();
      calculatedLife = result?.metrics?.Life?.status === 'available' ? result.metrics.Life.value : null;
      if (!(calculatedLife > 0)) throw new Error(`PoB Life result missing: ${JSON.stringify(result).slice(0, 1200)}`);
      delta = { role: 'assistant', content: 'POB_CLIENT_TEST_COMPLETE' }; finish = 'stop';
    }
    modelCalls++;
    const common = { id: `fixture-${modelCalls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } })); }
});
await new Promise((resolveListen, reject) => { modelServer.once('error', reject); modelServer.listen(0, '127.0.0.1', resolveListen); });
const modelPort = modelServer.address().port;
let serviceStarted = false;
try {
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(builds, { recursive: true })]);
  await copyFile(resolve('../pob-mcp/tests/fixtures/occ-vortex.xml'), join(builds, 'example.xml'));
  const dockerUser = process.platform === 'linux' && process.getuid && process.getgid ? ['--env', `POB_DOCKER_USER=${process.getuid()}:${process.getgid()}`] : [];
  await call('mcp', 'add', '--env', `POB_BUILDS_DIR=${builds}`, '--env', `POB_DOCKER_IMAGE=${image}`, '--env', 'POB_CMD=luajit', '--env', 'POE_TRADE_ENABLED=false', ...dockerUser, 'pob', '--', wrapper);
  const configPath = join(workspace, 'opencode.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.mcp.servers.pob.codemode = false;
  config.providers = { fixture: { name: 'Local test model', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${modelPort}/v1` }, models: { fixture: { name: 'Fixture', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 131072, output: 4096 } } } } };
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await call('service', 'set', 'port', String(port));
  // Starting the private managed service initializes this location; reload then
  // applies its project configuration before querying connection status.
  try { await call('mcp', 'list'); } finally { serviceStarted = true; }
  await call('reload');
  let stdout = '';
  const deadline = Date.now() + 15_000;
  do {
    stdout = (await call('mcp', 'list')).stdout;
    if (/pob\s+connected/.test(stdout)) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  } while (Date.now() < deadline);
  assert.match(stdout, /pob\s+connected/);
  const run = await runFile(executable, ['run', '--auto', '--model', 'fixture/fixture', '--format', 'json', 'Import example.xml and evaluate Life using the PoB tools.'], { cwd: workspace, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(run.stdout, /POB_CLIENT_TEST_COMPLETE/);
  assert.equal(modelCalls, 3); assert.ok(importedId); assert.ok(calculatedLife > 0);
  const events = run.stdout.trim().split('\n').map(line => JSON.parse(line));
  const calls = events.filter(event => event.type === 'tool_use').map(event => event.part);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].tool.endsWith('foundation_import_file') && calls[0].state.status === 'completed');
  assert.equal(JSON.parse(calls[0].state.output).id, importedId);
  assert.ok(calls[1].tool.endsWith('foundation_evaluate') && calls[1].state.status === 'completed');
  assert.equal(calls[1].state.input.snapshot_id, importedId);
  assert.equal(JSON.parse(calls[1].state.output).metrics.Life.value, calculatedLife);
  console.log(`OpenCode isolated MCP import and Life evaluation passed (Life ${calculatedLife})`);
} finally {
  if (serviceStarted) {
    const status = await call('service', 'status').catch(() => null);
    if (status?.stdout.trim() === `http://127.0.0.1:${port}`) await call('service', 'stop');
  }
  await new Promise(resolveClose => modelServer.close(resolveClose));
  await rm(dir, { recursive: true, force: true });
}
