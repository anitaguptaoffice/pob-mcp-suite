// Exercise the installed mcporter client with an isolated wrapper and build directory.
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wrapper = join(root, 'packages/pob-mcp-market/pob-docker-mcp/scripts/pob-mcp-docker.sh');
const image = process.env.POB_DOCKER_IMAGE;
if (!image) throw new Error('Set POB_DOCKER_IMAGE to a locally built foundation image');
const executable = process.env.MCPORTER_BIN || 'mcporter';
if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') throw new Error('This smoke test requires a numeric host UID and GID');
const dockerUser = `${process.getuid()}:${process.getgid()}`;
const directory = await mkdtemp(join(tmpdir(), 'pob-mcporter-smoke-'));
const common = ['--stdio', wrapper, '--name', 'pob-foundation-smoke', '--env', `POB_BUILDS_DIR=${directory}`, '--env', `POB_DOCKER_IMAGE=${image}`, '--env', `POB_DOCKER_USER=${dockerUser}`, '--env', 'POB_FOUNDATION_ENABLED=true', '--env', 'POB_LEGACY_ENABLED=false', '--env', 'POE_TRADE_ENABLED=false'];
const run = async args => JSON.parse((await exec(executable, args, { timeout: 150000, maxBuffer: 16 * 1024 * 1024 })).stdout);
const call = async (name, args) => {
  // For ad-hoc stdio, --tool avoids sending a qualified selector as the tool name.
  const result = await run(['call', ...common, '--tool', name, '--args', JSON.stringify(args), '--output', 'json', '--timeout', '120000']);
  assert.ok(!result.isError && !result.error, JSON.stringify(result));
  return result;
};
try {
  await cp(join(root, 'packages/pob-mcp/tests/fixtures/occ-vortex.xml'), join(directory, 'fixture.xml'));
  const listing = await run(['list', ...common, '--json']);
  assert.equal(listing.status, 'ok');
  for (const name of ['foundation_import_file', 'foundation_evaluate', 'foundation_derive_level', 'foundation_save_file', 'inspect_snapshot_cached_stats']) assert.equal(listing.tools.filter(tool => tool.name === name).length, 1, name);
  assert.ok(!listing.tools.some(tool => tool.name === 'lua_load_build' || tool.name === 'analyze_build'));
  const parent = await call('foundation_import_file', { build_name: 'fixture.xml' });
  const baseline = await call('foundation_evaluate', { snapshot_id: parent.id, fields: ['Life'] });
  assert.equal(baseline.metrics.Life.status, 'available');
  const child = await call('foundation_derive_level', { snapshot_id: parent.id, level: 98, trial: true });
  assert.equal(child.parentId, parent.id);
  const changed = await call('foundation_evaluate', { snapshot_id: child.id, fields: ['Life'] });
  assert.equal(changed.context.build.level, 98);
  assert.equal((await call('foundation_evaluate', { snapshot_id: parent.id, fields: ['Life'] })).context.build.level, 99);
  await call('foundation_save_file', { snapshot_id: child.id, build_name: 'saved.xml' });
  const reloaded = await call('foundation_import_file', { build_name: 'saved.xml' });
  const verified = await call('foundation_evaluate', { snapshot_id: reloaded.id, fields: ['Life'] });
  assert.equal(verified.context.build.level, 98);
  assert.equal(verified.metrics.Life.value, changed.metrics.Life.value);
  console.log('installed mcporter with isolated wrapper: discovery, import, calculate, derive, save and restart passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
