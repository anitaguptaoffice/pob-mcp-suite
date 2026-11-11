import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { gearedBuildXml } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-trade-preview-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'true', POE_SESSION_ID: '', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
mcp.child.stderr.on('data', () => {}); const exited = once(mcp.child, 'exit');
const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response)); return JSON.parse(response.result.content[0].text); };
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'trade-preview-live', version: '1' } }); mcp.notify('notifications/initialized', {});
  const xml = await readFile(gearedBuildXml, 'utf8');
  const parent = await call('foundation_import_build', { xml, source: 'trade-preview-fixture' });
  const budget = await call('screen_snapshot_budget_candidates', { snapshot_id: parent.id, league: 'Standard', budget_chaos: 100, searches: [{ slot: 'Ring 1', item_type: 'Gold Ring', limit: 2 }] });
  assert.equal(budget.complete, false); assert.equal(budget.combinedCost, null);
  const screened = budget.searches[0]; assert.equal(screened.status, 'searched', JSON.stringify(screened));
  assert.equal(screened.query.query.status.option, 'securable'); assert.equal(screened.query.query.filters.trade_filters.filters.sale_type.option, 'priced');
  assert.equal(screened.query.query.filters.trade_filters.filters.price.max, 100);
  assert.ok(screened.candidates.some(candidate => candidate.status === 'previewed' && candidate.priceEvidence === 'explicit_buyout' && candidate.preview.snapshotId === parent.id), JSON.stringify(screened));
  const search = await call('search_official_trade', { league: 'Standard', item_type: 'Gold Ring', item_rarity: 'rare', identified: true, limit: 5 });
  assert.equal(search.listingScope, 'instant_buyout'); assert.ok(search.listings.length > 0);
  assert.equal(search.query.query.status.option, 'securable');
  assert.equal(search.query.query.filters.trade_filters.filters.sale_type.option, 'priced');
  const searchId = search.searchId;
  assert.equal(searchId, decodeURIComponent(new URL(search.searchUrl).pathname.split('/').at(-1)));
  const ids = search.listings.map(listing => listing.id);
  const raw = await call('compare_official_trade_listings', { league: 'Standard', search_id: searchId, item_ids: ids });
  assert.equal(raw.listingScope, 'unknown'); assert.equal(raw.requestedCount, ids.length);
  assert.ok(Number.isFinite(Date.parse(raw.fetchedAt)));
  assert.deepEqual(raw.results.map(result => result.itemId), ids);
  assert.ok(raw.results.some(result => result.status === 'ok' && result.leagueStatus === 'match'));
  const report = await call('preview_trade_listings', { snapshot_id: parent.id, league: 'Standard', slot: 'Ring 1', search_id: searchId, item_ids: ids });
  assert.equal(report.snapshotId, parent.id); assert.equal(report.requestedCount, ids.length); assert.ok(Number.isFinite(Date.parse(report.fetchedAt)));
  const success = report.results.find(result => result.status === 'ok');
  assert.ok(success, JSON.stringify(report.results));
  assert.equal(success.preview.snapshotId, parent.id); assert.match(success.clipboardText, /Rarity:/);
  assert.ok(Number.isFinite(success.preview.baseline.Life)); assert.ok(Number.isFinite(success.preview.candidateStats.Life));
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  mcp.child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('official trade snapshot preview live integration passed');
} finally {
  if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
