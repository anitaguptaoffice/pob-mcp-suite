import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BuildFoundation } from '../../build/foundation/buildFoundation.js';
import { SnapshotStore } from '../../build/foundation/snapshotStore.js';
import { openPoBEngine } from '../../build/foundation/pobEngineAdapter.js';
import { createBudgetBundleTool } from '../../build/features/budgetCandidates/bundle.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-bundle-'));
const options = { cwd: smokePoBSrc(), command: process.env.POB_CMD, adapterPath: resolve('lua/vanilla_stdio_bridge.lua'), timeoutMs: 60000 };
const ids = ['b'.repeat(64), 'c'.repeat(64)], time = '2026-01-01T00:00:00.000Z';
const texts = ['Item Class: Rings\nRarity: RARE\nBundle One\nGold Ring\nItem Level: 86\nImplicits: 0\n+120 to maximum Life', 'Item Class: Rings\nRarity: RARE\nBundle Two\nGold Ring\nItem Level: 86\nImplicits: 0\n+140 to maximum Life'];
let next = 0;
const trade = {
  search: async (league, query) => { const i = next++; return { source: 'official-trade', fetchedAt: time, request: { league, query }, data: { id: `search-${i}`, result: [ids[i]], total: 1 } }; },
  fetchListings: async (requestIds, queryId) => { const i = ids.indexOf(requestIds[0]); return { source: 'official-trade', fetchedAt: time, request: { ids: requestIds, queryId }, data: { listings: [{ id: ids[i], item: { id: ids[i], league: 'Standard', verified: true, identified: true, typeLine: 'Gold Ring', name: i ? 'Bundle Two' : 'Bundle One', extended: { text: Buffer.from(texts[i]).toString('base64') } }, listing: { price: { type: '~b/o', amount: i ? 0.2 : 0.1, currency: 'chaos' } } }], missingIds: [] } }; },
};
try {
  const foundation = new BuildFoundation(new SnapshotStore(dir), () => openPoBEngine(options));
  const xml = await readFile(gearedBuildXml, 'utf8');
  const parent = await foundation.importBuild(xml, 'budget-bundle-fixture');
  const tool = createBudgetBundleTool(foundation, trade);
  const result = JSON.parse((await tool.invoke({ snapshot_id: parent.id, league: 'Standard', budget_chaos: 0.3, fields: ['Life'], searches: [{ slot: 'Ring 1', item_type: 'Gold Ring' }, { slot: 'Ring 2', item_type: 'Gold Ring' }] })).content[0].text);
  assert.equal(result.status, 'compared', JSON.stringify({ status: result.status, reason: result.reason, error: result.error }));
  assert.equal(result.subtotal.amount, '0.3'); assert.equal(result.trial.parentId, parent.id);
  const equipment = (await foundation.inspect(result.trial.snapshotId, ['items'])).data.items;
  assert.match(equipment.find(item => item.slot === 'Ring 1').raw, /\+120 to maximum Life/);
  assert.match(equipment.find(item => item.slot === 'Ring 2').raw, /\+140 to maximum Life/);
  const native = await foundation.evaluate(result.trial.snapshotId, ['Life']);
  assert.equal(result.comparison.metrics.Life.candidate.value, native.stats.Life);
  assert.equal(await foundation.exportBuild(parent.id), xml);
  console.log('budget bundle with real PoB and fixture Trade passed');
} finally { await rm(dir, { recursive: true, force: true }); }
