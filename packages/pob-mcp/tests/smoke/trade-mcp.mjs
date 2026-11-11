// Opt-in live MCP smoke test for the Path of Exile Trade API.
// Usage: npm run build && npm run test:smoke:trade
import { startMcpServer } from './mcpClient.mjs';

const { child, request, notify } = startMcpServer({ POB_LUA_ENABLED: 'false', POE_TRADE_ENABLED: 'true' });

const call = async (name, args = {}) => {
  const response = await request('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`${name} failed: ${JSON.stringify(response.error ?? response.result)}`);
  return response.result?.content?.[0]?.text || '';
};

try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'trade-smoke', version: '1.0' } });
  notify('notifications/initialized', {});
  const listed = await request('tools/list', {});
  const names = new Set(listed.result.tools.map((tool) => tool.name));
  for (const name of ['get_leagues', 'search_stats', 'search_trade_items', 'get_item_price', 'find_resistance_gear', 'reference_currency_rates', 'simulate_reference_currency_chain']) {
    if (!names.has(name)) throw new Error(`missing live trade MCP tool: ${name}`);
  }

  const leagues = await call('get_leagues');
  if (!leagues.includes('=== Available Leagues ===') || !leagues.includes('Standard')) throw new Error(`league lookup was incomplete: ${leagues}`);
  const stats = await call('search_stats', { query: 'maximum life', limit: 1 });
  if (!stats.includes('=== Official Trade Stat Sources')) throw new Error(`stat lookup was incomplete: ${stats}`);
  const search = await call('search_trade_items', { league: 'Standard', item_name: 'Tabula Rasa', item_rarity: 'unique', max_price: 1, price_currency: 'divine', limit: 1 });
  if (!search.includes('=== 交易搜索（Standard）===') && !search.includes('No items found')) throw new Error(`trade search was incomplete: ${search}`);
  const cluster = await call('search_cluster_jewels', { league: 'Standard', jewel_size: 'large', passive_count: 8, limit: 1 });
  if (!cluster.includes('=== Large Cluster Jewel Search Results ===') && !cluster.includes('No Large cluster jewels found')) throw new Error(`cluster jewel search was incomplete: ${cluster}`);
  if (cluster.includes('=== Large Cluster Jewel') && !cluster.includes('交易状态：securable')) throw new Error(`cluster jewel search did not use securable status: ${cluster}`);
  const price = await call('get_item_price', { league: 'Standard', item_name: 'Tabula Rasa', rarity: 'unique' });
  if (!price.includes('=== Price Check: Tabula Rasa ===') && !price.includes('No instant-buyout price data found') && !price.includes('No valid priced instant-buyout listings found')) throw new Error(`price check was incomplete: ${price}`);
  const resistance = await call('find_resistance_gear', { league: 'Standard', fire_resist_needed: 10, slots: ['Ring 1'], limit: 1 });
  if (!resistance.includes('=== Resistance Gear (Standard) ===') && !resistance.includes('没有符合指定通货和单件预算的候选')) throw new Error(`resistance recommendation was incomplete: ${resistance}`);
  const rates = JSON.parse(await call('reference_currency_rates', { league: 'Standard' }));
  if (!Array.isArray(rates.rates) || !rates.rates.some(rate => rate.name === 'Divine Orb') || !rates.fetchedAt) throw new Error(`currency reference rates were incomplete: ${JSON.stringify(rates)}`);
  if (!String(rates.warnings).includes('not executable')) throw new Error(`currency reference rates did not disclose their scope: ${JSON.stringify(rates.warnings)}`);
  if ('profit' in rates) throw new Error(`currency reference rates must not claim profit: ${JSON.stringify(rates)}`);
  const chain = JSON.parse(await call('simulate_reference_currency_chain', { league: 'Standard', currency_chain: ['Chaos Orb', 'Divine Orb', 'Chaos Orb'], start_amount: 10 }));
  if (!chain.complete || chain.steps?.length !== 2 || chain.result?.currency !== 'Chaos Orb' || Math.abs(chain.result.amount - 10) > 1e-6) throw new Error(`reference chain simulation was incomplete: ${JSON.stringify(chain)}`);
  if ('profit' in chain) throw new Error(`reference chain simulation must not claim executable profit: ${JSON.stringify(chain)}`);
  console.log('trade MCP passed: tool discovery, leagues, stat lookup, item search, price check, resistance recommendations, currency references, and chain simulation all succeeded');
} finally {
  child.kill();
}
