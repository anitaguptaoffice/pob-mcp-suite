// Opt-in integration test: real PoB and live public international economy data.
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';
import { gearedBuildXml } from './pobSource.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-cost-live-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_SNAPSHOT_DIRECTORY: dir, POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
mcp.child.stderr.on('data', () => {});
const exited = once(mcp.child, 'exit');
const call = async (name, args) => {
  const response = await mcp.request('tools/call', { name, arguments: args });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snapshot-cost-live', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const tools = await mcp.request('tools/list', {});
  assert.ok(tools.result.tools.some(tool => tool.name === 'estimate_snapshot_cost'));
  assert.ok(!tools.result.tools.some(tool => tool.name === 'estimate_build_cost'));
  const fixture = await readFile(gearedBuildXml, 'utf8');
  const item = fixture.match(/<Item id="3">[\s\S]*?<\/Item>/)?.[0];
  const firstSet = fixture.match(/<ItemSet\b[^>]*\bid="1"[^>]*>[\s\S]*?<\/ItemSet>/)?.[0];
  assert.ok(item && firstSet);
  const secondSet = firstSet.replace('id="1"', 'id="7" title="Swap"').replace('useSecondWeaponSet="false"', 'useSecondWeaponSet="true"').replace('<Slot name="Weapon 1 Swap" itemId="0"/>', '<Slot name="Weapon 1 Swap" itemId="999"/>');
  assert.ok(secondSet.includes('name="Weapon 1 Swap" itemId="999"'));
  const xml = fixture.replace(item, `${item}\n${item.replace('id="3"', 'id="999"')}`).replace(firstSet, `${firstSet}\n${secondSet}`);
  const imported = await call('foundation_import_build', { xml, source: 'cost-fixture' });
  const report = await call('estimate_snapshot_cost', { snapshot_id: imported.id, league: 'Standard' });
  assert.equal(report.snapshotId, imported.id);
  assert.equal(report.league, 'Standard');
  assert.equal(report.complete, false);
  assert.ok(report.unknownCount > 0 && report.entries.some(entry => entry.status === 'unknown'));
  assert.deepEqual(report.failures, []);
  assert.equal(report.sources.length, 6);
  assert.ok(report.sources.every(source => source.source === 'poe.ninja' && source.league === 'Standard' && Number.isFinite(Date.parse(source.fetchedAt))));
  const shopping = await call('list_snapshot_equipment', { snapshot_id: imported.id, league: 'Standard', include_reference: true });
  assert.equal(shopping.snapshotId, imported.id);
  assert.equal(shopping.reference.complete, false);
  assert.deepEqual(shopping.reference.entries, report.entries);
  assert.deepEqual(shopping.reference.sources, report.sources);
  assert.ok(shopping.slots.every(slot => slot.purchaseStatus === 'not_checked'));
  assert.ok(shopping.slots.some(slot => slot.state === 'equipped'));
  const cached = await call('estimate_snapshot_cost', { snapshot_id: imported.id, league: 'Standard' });
  assert.deepEqual(cached.sources, report.sources);
  const swapped = await call('foundation_derive_item_set', { snapshot_id: imported.id, item_set_id: 7, trial: true });
  const swappedCost = await call('estimate_snapshot_cost', { snapshot_id: swapped.id, league: 'Standard' });
  const swappedShopping = await call('list_snapshot_equipment', { snapshot_id: swapped.id, league: 'Standard', include_reference: true });
  assert.equal(swappedCost.activeItemSet.useSecondWeaponSet, true);
  assert.equal(swappedShopping.slots.find(slot => slot.slot === 'Weapon 1').inUse, false);
  assert.equal(swappedShopping.slots.find(slot => slot.slot === 'Weapon 1 Swap').inUse, true);
  assert.ok(swappedCost.excludedItems.some(entry => entry.slot === 'Weapon 1' && entry.itemId === 3));
  assert.ok(swappedCost.entries.some(entry => entry.kind === 'item' && entry.slot === 'Weapon 1 Swap'));
  assert.ok(!swappedCost.entries.some(entry => entry.kind === 'item' && entry.slot === 'Weapon 1'));
  assert.deepEqual(swappedCost.entries, swappedShopping.reference.entries);
  assert.deepEqual(swappedCost.sources, swappedShopping.reference.sources);
  assert.equal((await call('foundation_read_snapshot', { snapshot_id: imported.id })).id, imported.id);
  mcp.child.stdin.end();
  assert.equal((await exited)[0], 0);
  console.log('snapshot cost live integration passed');
} finally {
  if (mcp.child.exitCode === null && mcp.child.signalCode === null) { mcp.child.kill('SIGTERM'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
