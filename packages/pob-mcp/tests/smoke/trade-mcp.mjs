// Opt-in live MCP smoke test for the official international Trade API.
// Usage: npm run build && npm run test:smoke:trade
import { startMcpServer } from './mcpClient.mjs';

const { child, request, notify } = startMcpServer({ POE_TRADE_ENABLED: 'true' });

const raw = async (name, args = {}) => {
  const response = await request('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`${name} failed: ${JSON.stringify(response.error ?? response.result)}`);
  return response.result?.content?.[0]?.text || '';
};
const call = async (name, args = {}) => JSON.parse(await raw(name, args));

try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'trade-smoke', version: '1.0' } });
  notify('notifications/initialized', {});
  const listed = await request('tools/list', {});
  const names = new Set(listed.result.tools.map((tool) => tool.name));
  for (const name of ['list_trade_leagues', 'search_trade_stats', 'search_official_trade', 'sample_trade_item_price', 'search_resistance_listings', 'search_cluster_listings', 'reference_currency_rates', 'simulate_reference_currency_chain']) {
    if (!names.has(name)) throw new Error(`missing live trade MCP tool: ${name}`);
  }

  const leagues = await call('list_trade_leagues');
  if (!Array.isArray(leagues.leagues) || !leagues.leagues.includes('Standard') || !leagues.fetchedAt) throw new Error(`league lookup was incomplete: ${JSON.stringify(leagues)}`);
  const stats = await call('search_trade_stats', { query: 'maximum life', limit: 1 });
  if (!Array.isArray(stats.results) || !stats.results[0]?.sources?.length || !stats.fetchedAt) throw new Error(`stat lookup was incomplete: ${JSON.stringify(stats)}`);
  const search = await call('search_official_trade', { league: 'Standard', item_name: 'Tabula Rasa', item_rarity: 'unique', max_price: 1, price_currency: 'divine', limit: 1 });
  if (search.query?.query?.status?.option !== 'securable' || search.listingScope !== 'instant_buyout' || !Array.isArray(search.listings)) throw new Error(`trade search was incomplete: ${JSON.stringify(search).slice(0, 800)}`);
  const price = await call('sample_trade_item_price', { league: 'Standard', item_name: 'Tabula Rasa', rarity: 'unique', limit: 3 });
  if (!Array.isArray(price.byCurrency) || price.listingScope !== 'instant_buyout' || !price.priceEvidenceCounts) throw new Error(`price sample was incomplete: ${JSON.stringify(price).slice(0, 800)}`);
  const cluster = await call('search_cluster_listings', { league: 'Standard', jewel_size: 'large', passive_count: 8, limit: 1 });
  if (cluster.listingScope !== 'instant_buyout' || !Array.isArray(cluster.listings)) throw new Error(`cluster jewel search was incomplete: ${JSON.stringify(cluster).slice(0, 800)}`);
  const resistance = await call('search_resistance_listings', { league: 'Standard', resistance_minimums: { fire: 10 }, slots: ['Ring 1'], per_slot_limit: 1 });
  if (resistance.listingScope !== 'instant_buyout' || resistance.searches?.[0]?.status !== 'ok') throw new Error(`resistance search was incomplete: ${JSON.stringify(resistance).slice(0, 800)}`);
  const rates = await call('reference_currency_rates', { league: 'Standard' });
  if (!Array.isArray(rates.rates) || !rates.rates.some(rate => rate.name === 'Divine Orb') || !rates.fetchedAt) throw new Error(`currency reference rates were incomplete: ${JSON.stringify(rates)}`);
  if (!String(rates.warnings).includes('not executable')) throw new Error(`currency reference rates did not disclose their scope: ${JSON.stringify(rates.warnings)}`);
  if ('profit' in rates) throw new Error(`currency reference rates must not claim profit: ${JSON.stringify(rates)}`);
  const chain = await call('simulate_reference_currency_chain', { league: 'Standard', currency_chain: ['Chaos Orb', 'Divine Orb', 'Chaos Orb'], start_amount: 10 });
  if (!chain.complete || chain.steps?.length !== 2 || chain.result?.currency !== 'Chaos Orb' || Math.abs(chain.result.amount - 10) > 1e-6) throw new Error(`reference chain simulation was incomplete: ${JSON.stringify(chain)}`);
  if ('profit' in chain) throw new Error(`reference chain simulation must not claim executable profit: ${JSON.stringify(chain)}`);
  console.log('trade MCP passed: tool discovery, leagues, stat lookup, item search, price sample, resistance and cluster listing searches, currency references, and chain simulation all succeeded');
} finally {
  child.kill();
}
