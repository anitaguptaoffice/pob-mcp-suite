import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

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

function readText(result) {
  return (result.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");
}

async function callTool(name, args = {}) {
  const result = await request("tools/call", {
    name,
    arguments: args,
  });

  const text = readText(result);
  if (result.isError) {
    throw new Error(`${name} failed: ${text || JSON.stringify(result)}`);
  }
  if (/failed|error|exception/i.test(text)) {
    throw new Error(`${name} returned error-like output: ${text}`);
  }
  return result;
}

try {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "pob-mcp-smoke", version: "0.1.0" },
  });

  const tools = await request("tools/list");
  const names = new Set((tools.tools ?? []).map((tool) => tool.name));
  for (const required of ["lua_new_build", "lua_get_build_info", "lua_get_stats", "compare_equipment_candidate"]) {
    if (!names.has(required)) {
      throw new Error(`Required tool missing: ${required}`);
    }
  }

  await callTool("lua_new_build", { className: "Witch", ascendancy: "None" });
  await callTool("lua_get_build_info");
  await callTool("lua_get_stats", { category: "defense" });

  const jewel = await callTool("find_timeless_jewel_seeds", {
    socket_node_id: 60735,
    desired_node_ids: ["eternal_notable_minion_1"],
    seeds: [130660],
  });
  const matches = JSON.parse(readText(jewel));
  if (!matches.some((match) => match.seed === 130660 && match.hits?.length > 0)) {
    throw new Error("Timeless jewel lookup did not return the known seed");
  }

  const fixture = await readFile(new URL('../tests/fixtures/occ-vortex.xml', import.meta.url), 'utf8');
  await callTool('lua_load_build', { build_xml: fixture });
  const amuletText = fixture.match(/<Item id="2">([\s\S]*?)<\/Item>/)?.[1]?.trim();
  if (!amuletText) throw new Error('Item comparison fixture missing');
  const comparison = JSON.parse(readText(await callTool('compare_equipment_candidate', { slot: 'Amulet', item_text: amuletText.replace('+46 to maximum Life', '+96 to maximum Life') })));
  if (!(comparison.delta.Life > 0) || comparison.source !== 'current_live_pob') throw new Error('Item comparison MCP result is incomplete');
  const report = await request('tools/call', { name: 'export_build_summary', arguments: {} });
  const reportText = readText(report);
  if (report.isError || !reportText.includes('## 技能组') || !reportText.includes('Vortex') ||
      !reportText.includes('## 装备') || !reportText.includes('Rarity: RARE') ||
      !reportText.includes('## 计算配置') || reportText.includes('未取得装备数据') ||
      reportText.includes('未取得计算配置')) {
    throw new Error(`Build report smoke failed: ${reportText.slice(0, 1000)}`);
  }

  console.log("pob-mcp smoke passed");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}
