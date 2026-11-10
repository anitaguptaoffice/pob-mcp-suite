import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PoBLuaApiClient } from '../build/pobLuaBridge.js';
import { formatLoadStats } from '../build/handlers/luaHandlers.js';

const client = new PoBLuaApiClient({
  cwd: process.env.POB_FORK_PATH,
  cmd: process.env.POB_CMD,
  timeoutMs: 60000,
});

try {
  await client.start();
  await client.newBuild({ className: 'Scion' });
  await client.setTree({ classId: 0, ascendClassId: 2, nodes: [], treeVersion: '3_29' });
  const alternate = await client.getTree();
  assert.equal(alternate.ascendClassName, 'Reliquarian', `alternate ascendancy lost: ${JSON.stringify(alternate)}`);
  const eventTree = await client.setTree({ classId: 1, ascendClassId: 1, nodes: [], treeVersion: '3_28_alternate' });
  assert.equal(eventTree.ascendClassName, 'Ancestral Commander', `event ascendancy lost: ${JSON.stringify(eventTree)}`);
  const eventInfo = await client.getBuildInfo();
  assert.equal(eventInfo.ascendClassName, 'Ancestral Commander', `event build metadata lost: ${JSON.stringify(eventInfo)}`);
  await client.newBuild({ className: 'Witch' });
  await client.setTree({ classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
  const info = await client.getBuildInfo();
  assert.equal(info.className, 'Witch', `class metadata lost: ${JSON.stringify(info)}`);
  const masterySearch = await client.searchNodes({ keyword: 'mastery', nodeType: 'mastery', maxResults: 100, includeAllocated: false });
  assert.ok(masterySearch.nodes.length > 0, 'mastery filter returned no masteries in 3.29');
  assert.ok(masterySearch.nodes.every(node => node.type === 'mastery' && node.isMastery === true), 'mastery filter returned a different node type');
  const lifeMastery = await client.searchNodes({ keyword: 'Life Mastery', nodeType: 'mastery', maxResults: 100, includeAllocated: false });
  const targetMastery = lifeMastery.nodes.find(node => node.id === 4139);
  assert.ok(targetMastery?.pathNodes?.length, '3.29 life mastery path missing');
  const originalTree = await client.getTree();
  await client.setTree({ ...originalTree, nodes: [...originalTree.nodes, ...targetMastery.pathNodes], masteryEffects: { 4139: 47642 } });
  const masteryBefore = await client.getStats(['Life']);
  await assert.rejects(() => client.calcWith({ masteryEffects: { 4139: 999999 } }), /invalid or unallocated mastery effect/);
  assert.equal((await client.getTree()).masteryEffects['4139'], 47642, 'invalid mastery changed the build');
  const masterySimulated = await client.calcWith({ masteryEffects: { 4139: 31822 } });
  const masteryRestored = await client.getTree();
  const restoredStats = await client.getStats(['Life']);
  assert.equal(masteryRestored.masteryEffects['4139'], 47642, 'mastery selection changed after simulation');
  assert.equal(restoredStats.Life, masteryBefore.Life, 'mastery stats changed after simulation');
  await client.setTree({ ...masteryRestored, masteryEffects: { 4139: 31822 } });
  const masteryActual = await client.getStats(['Life']);
  assert.notEqual(masteryActual.Life, masteryBefore.Life, 'mastery fixture must change Life');
  assert.equal(masterySimulated.Life, masteryActual.Life, 'mastery simulation must match actual allocation');
  await client.newBuild({ className: 'Witch' });
  await client.setTree({ classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
  await client.createSocketGroup({ label: 'spell', slot: 'Weapon 1' });
  await client.addGem({ groupIndex: 1, gemName: 'Arc', level: 20 });
  await client.setMainSelection({ mainSocketGroup: 1 });
  const spell = await client.getStats();
  assert.ok(spell.TotalDPS > 0, `missing spell damage: ${JSON.stringify(spell)}`);
  // Known results from the 3.29 tree and PoB revision a69391d. A later engine
  // update may legitimately change them; investigate before updating fixtures.
  assert.ok(Math.abs(spell.TotalDPS - 1161.325) < 0.001, `spell baseline changed: ${spell.TotalDPS}`);
  assert.ok(spell.Life > 0, 'default stats must include life');
  const explicitSpell = await client.getStats(['TotalDPS']);
  assert.equal(spell.TotalDPS, explicitSpell.TotalDPS, 'default and explicit spell damage disagree');

  await client.createSocketGroup({ label: 'minion', slot: 'Helmet' });
  await client.addGem({ groupIndex: 2, gemName: 'Summon Raging Spirit', level: 20 });
  await client.setMainSelection({ mainSocketGroup: 2 });
  const minion = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS', 'Life']);
  assert.ok(minion.MinionTotalDPS > 0 || minion.MinionCombinedDPS > 0,
    `missing minion damage: ${JSON.stringify(minion)}`);
  assert.ok(Math.abs(minion.MinionTotalDPS - 246.18201754386) < 0.001,
    `minion baseline changed: ${minion.MinionTotalDPS}`);
  const poisonConfig = await client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' });
  assert.ok(poisonConfig.applied.customMods, 'poison fixture configuration rejected');
  const poisonBase = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
  assert.ok(poisonBase.MinionCombinedDPS > poisonBase.MinionTotalDPS, 'poison fixture must include ailment damage');
  assert.ok(formatLoadStats(poisonBase).join('\n').includes('MinionCombinedDPS: 302.94'), 'load summary omitted poison-inclusive damage');

  const jewels = await client.findTimelessJewelSeeds({
    socketNodeId: 60735, desired: ['eternal_notable_minion_1'], seeds: [130660],
  });
  assert.ok(jewels.some((result) => result.seed === 130660 && result.hits.length > 0), 'jewel lookup failed');
  const minionTree = await client.getTree();
  const minionCandidates = await client.searchNodes({ keyword: 'minion', nodeType: 'notable', maxResults: 100, includeAllocated: false });
  const minionTarget = minionCandidates.nodes.find(node => node.pathNodes?.length > 0 && node.pathNodes.includes(node.id));
  assert.ok(minionTarget, 'expected a reachable minion notable');
  const minionSimulation = await client.calcWith({ addNodes: minionTarget.pathNodes });
  assert.ok(minionSimulation.Minion?.TotalDPS > 0, 'minion simulation must expose minion damage');
  await client.setTree({ ...minionTree, nodes: [...minionTree.nodes, ...minionTarget.pathNodes] });
  const actualMinion = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
  assert.ok(Math.abs(actualMinion.MinionTotalDPS - minionSimulation.Minion.TotalDPS) < 0.01,
    `minion simulation disagrees with allocation: ${minionSimulation.Minion.TotalDPS} vs ${actualMinion.MinionTotalDPS}`);
  assert.ok(Math.abs(actualMinion.MinionCombinedDPS - minionSimulation.Minion.CombinedDPS) < 0.01,
    `poison minion combined DPS simulation disagrees with allocation: ${minionSimulation.Minion.CombinedDPS} vs ${actualMinion.MinionCombinedDPS}`);
  // This fixture was measured through both the pre-migration and new bridges
  // against the same PoB revision; it is not a desktop GUI measurement.
  const xml = await readFile(new URL('../tests/fixtures/occ-vortex.xml', import.meta.url), 'utf8');
  await client.loadBuildXml(xml, 'regression-fixture');
  const fixtureTree = await client.getTree();
  const fixtureStats = await client.getStats(['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'TotalEHP']);
  assert.equal(fixtureTree.className, 'Witch');
  assert.equal(fixtureTree.ascendClassName, 'Occultist');
  assert.equal(fixtureTree.nodes.length, 132);
  for (const [key, expected] of Object.entries({ Life: 6728, EnergyShield: 1611, TotalDPS: 211560.47733333, CombinedDPS: 975099.74644352, TotalEHP: 54887.631577226 })) {
    assert.ok(Math.abs(fixtureStats[key] - expected) < 0.01, `${key} changed: ${fixtureStats[key]}`);
  }
  const candidates = await client.searchNodes({ keyword: 'life', nodeType: 'notable', maxResults: 100, includeAllocated: false });
  const target = candidates.nodes.find(node => node.pathNodes?.length > 1 && node.pathNodes.includes(node.id));
  assert.ok(target, 'expected a reachable notable with a multi-point path');
  const simulated = await client.calcWith({ addNodes: target.pathNodes });
  assert.deepEqual((await client.getTree()).nodes, fixtureTree.nodes, 'simulation changed the active tree');
  await client.setTree({ ...fixtureTree, nodes: [...fixtureTree.nodes, ...target.pathNodes] });
  const actual = await client.getStats(['Life', 'TotalDPS', 'CombinedDPS']);
  for (const key of ['Life', 'TotalDPS', 'CombinedDPS']) {
    assert.ok(Math.abs(actual[key] - simulated[key]) < 0.01, `path simulation ${key} disagrees with allocation: ${simulated[key]} vs ${actual[key]}`);
  }
  console.log(JSON.stringify({ spellDps: spell.TotalDPS, minionDps: minion.MinionTotalDPS, jewels: jewels.length }));
} finally {
  await client.stop();
}
