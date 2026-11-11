// Run from the repository root against a locally built image.
import { strict as assert } from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const image = process.env.POB_DOCKER_IMAGE ?? 'pob-mcp-suite:local';
const dir = await mkdtemp(join(tmpdir(), 'pob-container-lock-'));
const name = `pob-lock-${randomUUID()}`;
const base = ['run', '--rm', '--entrypoint', 'node', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${dir}:/store`];
const acquire = `import { acquireStoreLock } from '/opt/pob-mcp/build/foundation/storeLock.js'; const release = await acquireStoreLock('/store');`;
let holder;
try {
  holder = spawn('docker', [...base, '-i', '--name', name, image, '--input-type=module', '-e', `${acquire} console.log('locked'); process.stdin.resume(); process.stdin.on('end', async () => { await release(); });`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; holder.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(holder, 'exit');
  await Promise.race([
    once(holder.stdout, 'data').then(([data]) => assert.equal(data.toString(), 'locked\n')),
    exited.then(([code]) => { throw new Error(`Holder exited early: ${code}: ${errors}`); }),
  ]);
  const marker = JSON.parse(await readFile(join(dir, '.writer.lock'), 'utf8'));
  assert.equal(marker.pid, 1, 'holder must be in its own PID namespace');
  const guard = await stat(join(dir, '.writer.guard'));
  assert.throws(() => execFileSync('docker', [...base, image, '--input-type=module', '-e', `${acquire} await release();`], { stdio: 'pipe' }), error => error.status !== 0 && error.stderr.toString().includes('Snapshot store is locked'));
  execFileSync('docker', ['kill', '--signal', 'KILL', name], { stdio: 'pipe' });
  assert.equal((await exited)[0], 137);
  execFileSync('docker', [...base, image, '--input-type=module', '-e', `${acquire} console.log('recovered'); await release();`], { stdio: 'pipe' });
  assert.equal((await stat(join(dir, '.writer.guard'))).ino, guard.ino);
  await assert.rejects(readFile(join(dir, '.writer.lock')), { code: 'ENOENT' });
  console.log('cross-container native lock exclusion and SIGKILL recovery passed');
} finally {
  if (holder && holder.exitCode === null && holder.signalCode === null) {
    try { execFileSync('docker', ['kill', '--signal', 'KILL', name], { stdio: 'pipe' }); } catch { /* container may already be gone */ }
    holder.kill();
  }
  await rm(dir, { recursive: true, force: true });
}
