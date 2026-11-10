#!/usr/bin/env node
// Test-only transport proxy: inject a real child-process failure after mutation.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const child = spawn(process.env.POB_TEST_REAL_CMD, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on('error', () => {});
child.on('exit', (code, signal) => { if (!process.exitCode) process.exitCode = code ?? (signal ? 1 : 0); });
process.on('SIGTERM', () => { child.kill('SIGKILL'); process.exit(0); });
createInterface({ input: process.stdin }).on('line', line => {
  let action;
  try { action = JSON.parse(line).action; } catch { child.stdin.write(line + '\n'); return; }
  if (action === 'unchanged_items_snapshot') {
    appendFileSync(process.env.POB_TEST_TRACE, 'capture\n');
    if (process.env.POB_TEST_FAILURE === 'crash') { child.kill('SIGKILL'); process.exit(1); }
    if (process.env.POB_TEST_FAILURE === 'timeout') return;
  }
  child.stdin.write(line + '\n');
});
