import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireStoreLock } from '../../build/foundation/storeLock.js';

if (process.argv[2] === '--hold') {
  const release = await acquireStoreLock(process.argv[3]);
  process.stdout.write('locked\n');
  process.stdin.resume();
  await once(process.stdin, 'end');
  await release();
} else {
  const dir = await mkdtemp(join(tmpdir(), 'pob-lock-process-'));
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--hold', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    const exited = once(child, 'exit');
    await Promise.race([
      once(child.stdout, 'data').then(([data]) => assert.equal(data.toString(), 'locked\n')),
      exited.then(([code]) => { throw new Error(`Lock holder exited early: ${code}: ${errors}`); }),
    ]);
    const guard = await stat(join(dir, '.writer.guard'));
    const before = JSON.parse(await readFile(join(dir, '.writer.lock'), 'utf8'));
    await assert.rejects(acquireStoreLock(dir), /locked/);
    child.kill('SIGKILL');
    assert.equal((await exited)[1], 'SIGKILL');
    // A container PID can appear alive on the host: ownership uses flock,
    // never kill(pid, 0). The marker's PID is intentionally irrelevant.
    await writeFile(join(dir, '.writer.lock'), JSON.stringify({ ...before, pid: process.pid }));
    const release = await acquireStoreLock(dir);
    const recovered = JSON.parse(await readFile(join(dir, '.writer.lock'), 'utf8'));
    assert.notEqual(recovered.token, before.token);
    await assert.rejects(acquireStoreLock(dir), /locked/);
    await release(); await release();
    assert.equal((await stat(join(dir, '.writer.guard'))).ino, guard.ino);
    await assert.rejects(readFile(join(dir, '.writer.lock')), { code: 'ENOENT' });

    for (const ambiguous of [JSON.stringify({ pid: 1, token: 'unrecognized' }), '', JSON.stringify({ ...before, guard: { ...before.guard, ino: '0' } })]) {
      await writeFile(join(dir, '.writer.lock'), ambiguous);
      await assert.rejects(acquireStoreLock(dir), /ambiguous or unrecognized/);
      assert.equal(await readFile(join(dir, '.writer.lock'), 'utf8'), ambiguous);
    }
    console.log('native store lock exclusion, SIGKILL recovery and ambiguous-marker preservation passed');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
}
