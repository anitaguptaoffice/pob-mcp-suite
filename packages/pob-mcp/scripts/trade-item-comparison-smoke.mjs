// Opt-in: one public international Trade search plus a disposable PoB engine.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { TradeApiClient } from '../build/services/tradeClient.js';
import { PoBLuaApiClient } from '../build/pobLuaBridge.js';
import { compareTradeListing, tradeClipboardText } from '../build/features/itemComparison/tradeListing.js';

const league = process.env.POB_TEST_LEAGUE;
if (!league) throw new Error('POB_TEST_LEAGUE is required');
const trade = new TradeApiClient();
const query = { query: { status: { option: 'securable' }, type: 'Citrine Amulet', filters: { type_filters: { filters: { rarity: { option: 'rare' } } } } }, sort: { price: 'asc' } };
const found = await trade.searchItems(league, query);
assert.ok(found.result?.length, 'no trade listings for smoke fixture');
const listing = (await trade.fetchItems(found.result.slice(0, 1), found.id))[0];
const text = tradeClipboardText(listing, league);
const client = new PoBLuaApiClient({ cwd: process.env.POB_FORK_PATH, cmd: process.env.POB_CMD, timeoutMs: 60000 });
try {
  await client.start();
  await client.loadBuildXml(await readFile(new URL('../tests/fixtures/occ-vortex.xml', import.meta.url), 'utf8'), 'trade-preview-smoke');
  const before = await client.getItems();
  const report = await compareTradeListing(trade, client, { league, slot: 'Amulet', item_id: listing.id, search_id: found.id });
  assert.equal(report.candidate.base, listing.item.baseType);
  assert.deepEqual(await client.getItems(), before, 'preview changed equipment');
  await client.addItem(text, 'Amulet');
  const actual = await client.getStats(['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'TotalEHP']);
  for (const key of Object.keys(actual)) {
    if (typeof actual[key] === 'number' && Number.isFinite(actual[key])) assert.ok(Math.abs(actual[key] - report.candidateStats[key]) < 0.01, `${key} differs from actual equipment`);
  }
  console.log('trade-to-PoB smoke passed: official clipboard, listing identity, preview, and actual equip match');
} finally { await client.stop(); }

// Also exercise tool discovery and the actual MCP route, not just the adapter.
const child = spawn('node', ['/opt/pob-mcp/build/index.js'], { env: { ...process.env, POB_LUA_ENABLED: 'true', POE_TRADE_ENABLED: 'true' }, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let requestId = 0;
createInterface({ input: child.stdout }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
child.stderr.resume();
function request(method, params = {}) {
  const id = ++requestId;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 60000);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return response;
}
try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'trade-preview-smoke', version: '1.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await request('tools/list');
  assert.ok(tools.result.tools.some(tool => tool.name === 'compare_trade_listing_in_pob'), 'trade preview MCP tool missing');
  const fixture = await readFile(new URL('../tests/fixtures/occ-vortex.xml', import.meta.url), 'utf8');
  const loaded = await request('tools/call', { name: 'lua_load_build', arguments: { build_xml: fixture } });
  assert.ok(!loaded.error && !loaded.result?.isError, 'MCP build load failed');
  const response = await request('tools/call', { name: 'compare_trade_listing_in_pob', arguments: { league, slot: 'Amulet', item_id: listing.id, search_id: found.id } });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response.error ?? response.result));
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.itemId, listing.id);
  assert.equal(report.source, 'current_live_pob');
  const batchIds = found.result.slice(0, 2);
  assert.equal(batchIds.length, 2, 'expected at least two listings for batch smoke test');
  const batchResponse = await request('tools/call', { name: 'compare_trade_listings_in_pob', arguments: { league, slot: 'Amulet', item_ids: batchIds, search_id: found.id } });
  assert.ok(!batchResponse.error && !batchResponse.result?.isError, JSON.stringify(batchResponse.error ?? batchResponse.result));
  const batch = JSON.parse(batchResponse.result.content[0].text);
  assert.equal(batch.results.length, 2);
  assert.equal(batch.results[0].status, 'ok');
  assert.equal(batch.results[0].result.candidateStats.Life, report.candidateStats.Life);
  assert.equal(batch.results[0].result.baseline.Life, report.baseline.Life);
  assert.ok(batch.results.every(row => row.status === 'ok' || row.status === 'error'));
  console.log('trade-to-PoB MCP route passed');
} finally { child.kill(); }
