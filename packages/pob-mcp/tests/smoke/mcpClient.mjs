// A JSON-RPC stdio client for the MCP smoke tests, so the transport lives in
// one place rather than once per test file.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Spawn the built server and return { child, request, notify }.
 * `env` is merged over the parent environment.
 */
export function startMcpServer(env = {}, timeoutMs = Number(process.env.SMOKE_MCP_TIMEOUT_MS ?? 60_000)) {
  const child = spawn('node', [resolve('build/index.js')], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });

  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = nextId++;
    const requestName = params?.name ? `${method} (${params.name})` : method;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timed out after ${timeoutMs} ms: ${requestName}`));
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, message => {
      clearTimeout(timer);
      resolveRequest(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

  return { child, request, notify };
}
