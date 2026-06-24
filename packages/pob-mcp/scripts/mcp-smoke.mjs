import { spawn } from "node:child_process";
import { once } from "node:events";

const command = process.argv[2] ?? "node";
const args = process.argv.slice(3);

if (args.length === 0 && command === "node") {
  args.push("build/index.js");
}

const child = spawn(command, args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    POB_LUA_ENABLED: process.env.POB_LUA_ENABLED ?? "true",
    POE_TRADE_ENABLED: process.env.POE_TRADE_ENABLED ?? "false",
  },
});

let buffer = "";
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");

    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(`MCP server exited before response: code=${code} signal=${signal}`));
  }
  pending.clear();
});

function request(method, params = {}) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, Number(process.env.POB_MCP_SMOKE_TIMEOUT_MS ?? 120000));
    pending.set(id, { resolve, reject, timer });
  });
}

try {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "pob-mcp-smoke", version: "0.1.0" },
  });

  const tools = await request("tools/list");
  const names = new Set((tools.tools ?? []).map((tool) => tool.name));
  for (const required of ["lua_new_build", "lua_get_build_info", "lua_get_stats"]) {
    if (!names.has(required)) {
      throw new Error(`Required tool missing: ${required}`);
    }
  }

  await request("tools/call", {
    name: "lua_new_build",
    arguments: { className: "Witch", ascendancy: "None" },
  });
  await request("tools/call", {
    name: "lua_get_build_info",
    arguments: {},
  });
  await request("tools/call", {
    name: "lua_get_stats",
    arguments: { category: "defense" },
  });

  console.log("pob-mcp smoke passed");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}
