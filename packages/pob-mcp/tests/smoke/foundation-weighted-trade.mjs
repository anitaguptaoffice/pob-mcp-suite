import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-weighted-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 180000 });
let child;
try {
  await client.start(); await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'));
  const group = await client.createSocketGroup({ label: 'poison-minion', slot: 'Helmet' });
  await client.addGem({ groupIndex: group.index, gemName: 'Summon Raging Spirit', level: 20 });
  await client.setMainSelection({ mainSocketGroup: group.index });
  assert.ok((await client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' })).applied.customMods);
  const stats = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS', 'Life', 'CombinedDPS', 'FullDPS', 'ChaosResist']);
  assert.ok(stats.MinionCombinedDPS > stats.MinionTotalDPS && stats.MinionTotalDPS > 0);
  const nativeOptions = stat => ({ statWeights: [{ label: stat, stat, weightMult: 1 }], includeCorrupted: true, includeMirrored: false, includeEldritch: false, includeScourge: false, maxPrice: 30, maxPriceType: 'chaos' });
  const nativePoison = await client.generateWeightedTradeQueryV2('Amulet', nativeOptions('MinionCombinedDPS'));
  const nativeHit = await client.generateWeightedTradeQueryV2('Amulet', nativeOptions('MinionTotalDPS'));
  const { xml } = await client.unchangedItemsSnapshot(); await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POE_TRADE_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_TIMEOUT_MS: '180000', POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') }, 180000);
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'weighted-trade-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1600)); return JSON.parse(response.result.content[0].text); };
  const parent = await call('foundation_import_build', { xml, source: 'poison-weighted-fixture' });
  const category = await call('evaluate_snapshot_stat_category', { snapshot_id: parent.id, category: 'all' });
  for (const name of ['Life', 'CombinedDPS', 'FullDPS', 'MinionCombinedDPS', 'ChaosResist']) {
    if (typeof stats[name] === 'number' && Number.isFinite(stats[name])) {
      assert.equal(category.metrics[name].status, 'available'); assert.ok(Math.abs(category.metrics[name].value - stats[name]) < 0.01);
    } else assert.equal(category.metrics[name].status, 'unknown');
  }
  assert.ok(category.metrics.MinionCombinedDPS.value > category.metrics.MinionTotalDPS.value);
  const result = await call('generate_snapshot_weighted_trade', { snapshot_id: parent.id, slot: 'Amulet', weights: [{ stat: 'MinionCombinedDPS', weight: 1 }], max_price: 30, price_currency: 'chaos' });
  assert.equal(result.snapshotId, parent.id); assert.equal(result.weightBaselines[0].stat, 'MinionCombinedDPS');
  assert.ok(Math.abs(result.weightBaselines[0].value - stats.MinionCombinedDPS) < 0.01);
  assert.equal(result.query.query.status.option, 'securable'); assert.equal(result.query.query.filters.trade_filters.filters.sale_type.option, 'priced');
  assert.equal(result.query.query.filters.trade_filters.filters.price.max, 30); assert.equal(result.query.query.filters.trade_filters.filters.price.option, 'chaos');
  assert.ok(result.query.query.stats.some(group => group.type === 'weight' && group.filters.length > 0));
  const hitOnly = await call('generate_snapshot_weighted_trade', { snapshot_id: parent.id, slot: 'Amulet', weights: [{ stat: 'MinionTotalDPS', weight: 1 }], max_price: 30, price_currency: 'chaos' });
  assert.ok(Math.abs(hitOnly.weightBaselines[0].value - stats.MinionTotalDPS) < 0.01);
  const canonicalGroups = groups => groups.map(group => ({ ...group, filters: [...group.filters].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }));
  assert.deepEqual(canonicalGroups(result.query.query.stats), canonicalGroups(nativePoison.query.query.stats));
  assert.deepEqual(canonicalGroups(hitOnly.query.query.stats), canonicalGroups(nativeHit.query.query.stats));
  const combined = await call('generate_snapshot_weighted_trade', { snapshot_id: parent.id, slot: 'Amulet', weights: [{ stat: 'CombinedDPS', weight: 1 }] });
  assert.ok(combined.weightBaselines[0].value >= stats.MinionCombinedDPS);
  assert.notEqual(combined.weightBaselines[0].value, combined.observedStats.CombinedDPS);
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('foundation weighted trade passed');
} finally { if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); } await client.stop(); await rm(dir, { recursive: true, force: true }); }
