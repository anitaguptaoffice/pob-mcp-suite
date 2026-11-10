import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-cluster-live-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'true', POE_SESSION_ID: '', POB_SNAPSHOT_DIRECTORY: dir });
mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cluster-live', version: '1' } }); mcp.notify('notifications/initialized', {});
  const response = await mcp.request('tools/call', { name: 'search_cluster_listings', arguments: { league: 'Standard', jewel_size: 'large', passive_count: 8, min_item_level: 84, max_price: 1000, price_currency: 'chaos', limit: 4 } });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.listingScope, 'instant_buyout'); assert.equal(report.query.query.status.option, 'securable');
  assert.equal(report.query.query.filters.trade_filters.filters.sale_type.option, 'priced');
  assert.equal(report.query.query.filters.type_filters.filters.ilvl.min, 84);
  assert.equal(report.query.query.filters.trade_filters.filters.price.max, 1000);
  const filters = report.query.query.stats[0].filters;
  assert.deepEqual(filters.map(filter => filter.id), ['enchant.stat_3086156145', 'explicit.stat_3086156145']);
  assert.ok(filters.every(filter => filter.value.min === 8 && filter.value.max === 8));
  assert.ok(report.totalMatches > 0 && report.fetchedCount > 0 && report.listings.length > 0);
  assert.ok(report.fetches.every(fetch => fetch.fetchedAt && Number.isFinite(Date.parse(fetch.fetchedAt))));
  assert.ok(report.listings.every(listing => listing.item.typeLine === 'Large Cluster Jewel'));
  assert.ok(report.listings.every(listing => listing.listing.price.currency === 'chaos' && listing.listing.price.amount <= 1000));
  mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('cluster trade live integration passed');
} finally {
  if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
