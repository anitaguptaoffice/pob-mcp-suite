// Opt-in real PoB and live international economy/trade smoke test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startMcpServer } from './mcpClient.mjs';

const { child, request, notify } = startMcpServer({ POB_LUA_ENABLED: 'true', POE_TRADE_ENABLED: 'true' });
const call = async (name, args) => {
  const response = await request('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`${name}: ${JSON.stringify(response.error ?? response.result)}`);
  return JSON.parse(response.result.content[0].text);
};

try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'economy-smoke', version: '1.0' } });
  notify('notifications/initialized', {});
  const tools = await request('tools/list', {});
  for (const name of ['estimate_build_cost', 'estimate_comparable_item', 'compare_craft_budget']) {
    assert.ok(tools.result.tools.some(tool => tool.name === name), `missing ${name}`);
  }
  const fixture = await readFile(new URL('../fixtures/occ-vortex.xml', import.meta.url), 'utf8');
  const loaded = await request('tools/call', { name: 'lua_load_build', arguments: { build_xml: fixture } });
  if (loaded.error || loaded.result?.isError) throw new Error(`load: ${JSON.stringify(loaded)}`);
  const cost = await call('estimate_build_cost', { league: 'Standard' });
  assert.equal(cost.league, 'Standard');
  assert.equal(cost.complete, false);
  assert.ok(cost.entries.some(entry => entry.kind === 'item' && entry.status === 'unknown'));
  assert.ok(cost.entries.some(entry => entry.kind === 'gem'));
  assert.ok(!cost.warnings.some(warning => warning.includes('行情不可用')), JSON.stringify(cost.warnings));
  const trade = await call('estimate_comparable_item', { league: 'Standard', base_type: 'Hubris Circlet', stat_groups: [{ type: 'and', filters: [{ stat_id: 'explicit.stat_3299347043', min: 40 }] }], limit: 3 });
  assert.equal(trade.baseType, 'Hubris Circlet');
  assert.ok(trade.searchUrl.includes('/Standard/'));
  const model = await call('compare_craft_budget', { buy_chaos: 30, scenarios: [{ name: 'example', success_probability: 0.1, chaos_per_attempt: 2, probability_source: 'synthetic test input' }] });
  assert.equal(model.scenarios[0].expectedChaos, 20);
  console.log(`economy MCP passed: ${cost.pricedCount} reference prices, ${cost.unknownCount} unknown, ${trade.fetchedCount} trade samples`);
} finally {
  child.kill();
}
