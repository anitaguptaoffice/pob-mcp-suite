// Runs the real-engine smoke scripts with bounded parallelism.
//
// Each script owns its temp directories and server process, so scripts are
// independent. The pool keeps a CI runner busy without exhausting memory.
//
// Usage: node scripts/smoke-suite.mjs [suite] [filter...] [--jobs=N] [--skip=a,b]
//   SMOKE_CONCURRENCY  default jobs (falls back to min(4, cpus))
//   SMOKE_TIMEOUT_MS   per-script timeout (default 15 minutes)
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const suites = {
  foundation: [
    'foundation-requirements', 'foundation-retention', 'foundation-roundtrip',
    'foundation-tree-code', 'foundation-official-tree', 'foundation',
    'foundation-selection', 'foundation-gem', 'foundation-group-toggle',
    'foundation-flask', 'foundation-item-sets', 'foundation-inventory',
    'foundation-specs', 'foundation-minion', 'foundation-failures',
    'foundation-mastery', 'foundation-item', 'foundation-mcp',
    'foundation-sdk', 'foundation-timeless', 'foundation-notes',
    'foundation-tree-paths', 'foundation-issues', 'foundation-mastery-job',
    'foundation-gem-setup-job', 'foundation-passive-ranking', 'modifier-data',
    'foundation-anointment', 'foundation-file-catalog', 'foundation-summary',
    'foundation-skill-inspection', 'foundation-config-presets',
    'foundation-enemy-config', 'foundation-ailments', 'foundation-defenses',
    'foundation-crafting-context', 'pob-item-data', 'pob-engine-status',
    'foundation-cluster-analysis', 'local-cluster-file',
    'foundation-watchers-eye', 'foundation-watchers-eye-comparison',
    'foundation-jewel-comparison', 'foundation-jewel-poison',
    'foundation-jewel-jobs', 'foundation-create-build',
    'foundation-weighted-trade', 'foundation-tree-source',
    'foundation-discovered-support', 'foundation-budget-bundle',
  ],
};

const args = process.argv.slice(2);
const suiteName = args[0] && !args[0].startsWith('-') ? args[0] : 'foundation';
const suite = suites[suiteName];
if (!suite) {
  console.error(`Unknown smoke suite: ${suiteName}. Available: ${Object.keys(suites).join(', ')}`);
  process.exit(2);
}

const option = (name) => {
  const match = args.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  return match === undefined ? undefined : match.slice(name.length + 3);
};
const filters = args.slice(1).filter(arg => !arg.startsWith('-'));
const skip = new Set((option('skip') ?? '').split(',').map(item => item.trim()).filter(Boolean));
const jobs = Math.max(1, Number(option('jobs') ?? process.env.SMOKE_CONCURRENCY ?? Math.min(4, Math.max(1, cpus().length))));
const timeoutMs = Math.max(1_000, Number(process.env.SMOKE_TIMEOUT_MS ?? 15 * 60_000));
const outputLimit = 64 * 1024;

const selected = suite
  .filter(name => !filters.length || filters.some(filter => name.includes(filter)))
  .filter(name => !skip.has(name));

if (!selected.length) {
  console.error('No smoke scripts matched the requested filters');
  process.exit(2);
}

const children = new Set();
const failures = [];
let next = 0;
let running = 0;

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function finish() {
  for (const failure of failures) {
    console.error(`\n--- ${failure.name} output ---\n${failure.output.slice(-8000)}`);
  }
  if (failures.length) {
    console.error(`\n${failures.length}/${selected.length} smoke scripts failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${selected.length} smoke scripts passed with ${jobs} parallel jobs`);
}

function launch() {
  while (running < jobs && next < selected.length) {
    const name = selected[next++];
    const started = Date.now();
    const child = spawn(process.execPath, [path.join('tests', 'smoke', `${name}.mjs`)], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    children.add(child);
    running++;
    let output = '';
    let timedOut = false;
    const append = (chunk) => {
      output += chunk;
      if (output.length > outputLimit) output = output.slice(-outputLimit);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      append(`\n[smoke timeout after ${timeoutMs} ms]`);
      killTree(child);
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      running--;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const failed = code !== 0 || timedOut;
      if (!failed) console.log(`ok   ${name} (${seconds}s)`);
      else {
        console.error(`FAIL ${name} (${seconds}s, code=${code}${signal ? `, signal=${signal}` : ''}${timedOut ? ', timeout' : ''})`);
        failures.push({ name, output: `${output}\n[exit code=${code} signal=${signal}]` });
      }
      if (next >= selected.length && running === 0) finish();
      else launch();
    });
  }
}

process.on('SIGINT', () => {
  for (const child of children) killTree(child);
  process.exit(130);
});

console.log(`${selected.length} scripts, ${jobs} parallel jobs, ${timeoutMs} ms timeout each`);
launch();
