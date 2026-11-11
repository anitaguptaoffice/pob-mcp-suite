import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-currency-live-'));
const mcp = startMcpServer({ POB_SNAPSHOT_DIRECTORY: dir });
mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
const call = async (name, args) => {
  const response = await mcp.request('tools/call', { name, arguments: args });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'currency-live', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const rates = await call('reference_currency_rates', { league: 'Standard' });
  assert.equal(rates.source, 'poe.ninja'); assert.equal(rates.league, 'Standard');
  assert.ok(Number.isFinite(Date.parse(rates.fetchedAt)));
  assert.ok(rates.rates.some(rate => rate.name === 'Chaos Orb' && rate.chaosValue === 1));
  const divine = rates.rates.find(rate => rate.name === 'Divine Orb'); assert.ok(divine?.chaosValue > 0);
  const chain = await call('simulate_reference_currency_chain', { league: 'Standard', currency_chain: ['Divine Orb', 'Chaos Orb'] });
  assert.equal(chain.fetchedAt, rates.fetchedAt); assert.equal(chain.result.amount, divine.chaosValue);
  const missing = await call('simulate_reference_currency_chain', { league: 'Standard', currency_chain: ['Chaos Orb', 'No Such Currency Fixture'] });
  assert.equal(missing.complete, false); assert.equal(missing.result, null); assert.deepEqual(missing.missingRates, ['No Such Currency Fixture']);
  const spread = await call('screen_currency_spreads', { league: 'Standard' });
  assert.equal(spread.listingScope, 'stash_aggregate_unverified'); assert.ok(spread.availableCurrencies > 0);
  assert.ok(Number.isFinite(Date.parse(spread.fetchedAt)));
  assert.ok(spread.quotes.every(quote => quote.sellChaos === 1 / quote.pay.value && quote.buyChaos === quote.receive.value));
  const cachedSpread = await call('screen_currency_spreads', { league: 'Standard' });
  assert.equal(cachedSpread.fetchedAt, spread.fetchedAt);
  mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('currency reference live integration passed');
} finally {
  if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
