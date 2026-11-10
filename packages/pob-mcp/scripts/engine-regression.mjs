import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PoBLuaApiClient } from '../build/pobLuaBridge.js';
import { parseModFile } from '../build/services/modDataStore.js';
import { firstMatchingSpawnRule } from '../build/services/affixQuery.js';
import { formatLoadStats } from '../build/handlers/luaHandlers.js';
import { handleFindItemUpgrades } from '../build/handlers/itemShoppingHandler.js';

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
  const ruleItemsBefore = await client.getItems();
  const amuletWeight = await client.getItemAffixWeight('AddedPhysicalDamage7', 'Rarity: RARE\nWeight Test\nCitrine Amulet\nItem Level: 1\nImplicits: 0');
  const ringWeight = await client.getItemAffixWeight('AddedPhysicalDamage7', 'Rarity: RARE\nWeight Test\nGold Ring\nItem Level: 86\nImplicits: 0');
  assert.equal(amuletWeight.weight, 1000, 'PoB amulet spawn weight changed');
  assert.equal(ringWeight.weight, 0, 'PoB ring zero-weight rule changed');
  const modData = await readFile(join(process.env.POB_PATH || process.env.POB_FORK_PATH || '/opt/PathOfBuilding/src', 'Data/ModExplicit.lua'), 'utf8');
  const ruleMod = parseModFile(modData, 'explicit').find(mod => mod.id === 'AddedPhysicalDamage7');
  assert.ok(ruleMod, 'expected modifier missing from PoB data');
  assert.equal(firstMatchingSpawnRule(ruleMod, ['amulet', 'default'])?.weight, amuletWeight.weight, 'parsed amulet rule disagrees with PoB');
  assert.equal(firstMatchingSpawnRule(ruleMod, ['ring', 'default'])?.weight, ringWeight.weight, 'parsed ring rule disagrees with PoB');
  const armour = 'Rarity: RARE\nWeight Test\nVaal Regalia\nItem Level: 100\nImplicits: 0';
  const elevatedMod = 'LocalIncreaseSocketedActiveGemLevelUberMaven';
  const noInfluence = await client.getItemAffixWeight(elevatedMod, armour);
  const shaperInfluence = await client.getItemAffixWeight(elevatedMod, `${armour}\nShaper Item`);
  assert.equal(noInfluence.weight, 0, 'Elevated modifier unexpectedly matched un-influenced armour');
  assert.equal(shaperInfluence.weight, 1000, 'PoB Elevated influence override was not applied');
  const elevatedRule = parseModFile(modData, 'explicit').find(mod => mod.id === elevatedMod);
  assert.equal(firstMatchingSpawnRule(elevatedRule, ['body_armour_shaper', 'default'])?.weight, 0, 'fixture must demonstrate raw weight override');
  const weapon = 'Rarity: RARE\nWeight Test\nGlass Shank\nItem Level: 86\nImplicits: 0';
  const dagger = await client.getItemAffixWeight('LocalIncreasedPhysicalDamagePercentAndAccuracyRating1', weapon);
  assert.equal(dagger.weight, 1000, 'PoB failed to apply the first matching attack-dagger multiplier');
  assert.equal(amuletWeight.itemLevel, 1);
  assert.equal(amuletWeight.requiredItemLevel, 52);
  await assert.rejects(() => client.getItemAffixWeight('NotARealMod', 'Rarity: RARE\nTest\nCitrine Amulet'), /not found/);
  assert.deepEqual(await client.getItems(), ruleItemsBefore, 'affix weight inspection changed live equipment');
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
  const costSnapshot = await client.getCostSnapshot();
  assert.deepEqual(costSnapshot.items, await client.getItems(), 'cost snapshot equipment differs from live build');
  assert.deepEqual(costSnapshot.skills, await client.getSkills(), 'cost snapshot skills differ from live build');
  const beforeItems = await client.getItems();
  const amuletText = xml.match(/<Item id="2">([\s\S]*?)<\/Item>/)?.[1]?.trim();
  assert.ok(amuletText?.includes('+46 to maximum Life'), 'amulet fixture changed');
  const candidateText = amuletText.replace('+46 to maximum Life', '+96 to maximum Life');
  const itemPreview = await client.compareItem('Amulet', candidateText);
  const unknownLine = '+123 to Imaginary Unicorn Protection';
  const diagnosticPreview = await client.compareItem('Amulet', `${candidateText}\n${unknownLine}`);
  assert.equal(diagnosticPreview.parseDiagnostics?.candidate.available, true, 'candidate parser diagnostics unavailable');
  assert.ok(diagnosticPreview.parseDiagnostics.candidate.unparsed.some(entry => entry.line === unknownLine && entry.group === 'explicit'), 'unsupported item mod was not reported');
  assert.ok(!diagnosticPreview.parseDiagnostics.candidate.unparsed.some(entry => entry.line === '+96 to maximum Life'), 'supported life mod was falsely reported as unsupported');
  assert.ok(itemPreview.candidateStats.Life > itemPreview.baseline.Life, 'item preview did not change life');
  assert.deepEqual(await client.getItems(), beforeItems, 'item preview changed equipped items');
  assert.deepEqual(await client.getStats(['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'TotalEHP']), fixtureStats, 'item preview changed live stats');
  await assert.rejects(() => client.compareItem('Helmet', candidateText), /incompatible/);
  assert.deepEqual(await client.getItems(), beforeItems, 'rejected item preview changed equipped items');
  await client.addItem(candidateText, 'Amulet');
  const itemEquipped = await client.getStats(['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'TotalEHP']);
  for (const key of ['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'TotalEHP']) {
    assert.ok(Math.abs(itemEquipped[key] - itemPreview.candidateStats[key]) < 0.01, `item preview ${key} disagrees with actual equipment`);
  }
  await client.loadBuildXml(xml, 'regression-fixture');
  const shieldText = xml.match(/<Item id="1">([\s\S]*?)<\/Item>/)?.[1]?.trim();
  assert.ok(shieldText?.includes('Quality: 0'), 'shield quality fixture changed');
  const shieldWithoutId = shieldText.replace(/^Unique ID:.*\r?\n/m, '');
  const shieldZero = await client.compareItem('Weapon 2', shieldWithoutId);
  const shieldTwenty = await client.compareItem('Weapon 2', shieldWithoutId.replace('Quality: 0', 'Quality: 20'));
  assert.equal(shieldZero.candidate.quality, 0, 'preview raised the actual quality');
  assert.equal(shieldTwenty.candidate.quality, 20);
  assert.ok(shieldTwenty.candidateStats.EnergyShield > shieldZero.candidateStats.EnergyShield, 'quality fixture must affect energy shield');
  await client.addItem(shieldWithoutId, 'Weapon 2');
  const shieldEquipped = await client.getStats(['EnergyShield', 'TotalEHP']);
  for (const key of ['EnergyShield', 'TotalEHP']) assert.ok(Math.abs(shieldEquipped[key] - shieldZero.candidateStats[key]) < 0.01, `zero quality ${key} differs from actual equipment`);
  await client.loadBuildXml(xml, 'regression-fixture');
  const shoppingContext = await handleFindItemUpgrades({ getLuaClient: () => client }, { slot: 'Amulet' });
  assert.ok(shoppingContext.content[0].text.includes(`Life: ${fixtureStats.Life}`), 'shopping context does not match live PoB Life');
  assert.ok(shoppingContext.content[0].text.includes('Prices and candidate items have not been checked'), 'shopping context must disclose missing price data');
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
  await client.loadBuildXml(xml, 'poison-anoint-fixture');
  const group = await client.createSocketGroup({ label: 'poison-minion', slot: 'Helmet' });
  await client.addGem({ groupIndex: group.index, gemName: 'Summon Raging Spirit', level: 20 });
  await client.setMainSelection({ mainSocketGroup: group.index });
  await client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' });
  const itemIdentity = items => items.filter(item => item.id > 0).map(({ slot, id, raw }) => ({ slot, id, raw }));
  const originalItems = itemIdentity(await client.getItems());
  const originalAnointStats = await client.getStats(['Life', 'MinionTotalDPS', 'MinionCombinedDPS']);
  const originalAnointTree = await client.getTree();
  const originalSnapshotSkills = await client.getSkills();
  const originalSnapshotConfig = await client.getConfig();
  const snapshot = await client.itemComparisonSnapshot();
  assert.deepEqual(itemIdentity(await client.getItems()), originalItems, 'snapshot changed equipped items');
  assert.deepEqual(await client.getStats(['Life', 'MinionTotalDPS', 'MinionCombinedDPS']), originalAnointStats, 'snapshot changed live stats');
  assert.deepEqual(await client.getTree(), originalAnointTree, 'snapshot changed passive tree');
  assert.deepEqual(await client.getSkills(), originalSnapshotSkills, 'snapshot changed selected skills');
  assert.deepEqual(await client.getConfig(), originalSnapshotConfig, 'snapshot changed configuration');
  assert.ok(snapshot.baseline.MinionCombinedDPS > 0, 'snapshot lost selected minion skill');
  const snapshotClient = new PoBLuaApiClient({ cwd: process.env.POB_FORK_PATH, cmd: process.env.POB_CMD, timeoutMs: 60000 });
  try {
    await snapshotClient.start();
    await snapshotClient.loadBuildXml(snapshot.xml, 'snapshot-regression');
    const isolatedPreview = await snapshotClient.compareItem('Amulet', candidateText);
    for (const key of Object.keys(snapshot.baseline)) {
      assert.ok(Math.abs(snapshot.baseline[key] - isolatedPreview.baseline[key]) < 0.01, `snapshot baseline ${key} disagrees after reload`);
    }
  } finally { await snapshotClient.stop(); }
  const anoint = await client.evaluateAnointCandidates({ slot: 'Amulet', focus: 'dps', limit: 5 });
  assert.equal(anoint.base.damageStat, 'MinionCombinedDPS', 'anoint ranking must score poison-inclusive minion damage');
  assert.ok(anoint.base.damageValue > 0 && anoint.candidates.some(candidate => candidate.dpsDelta > 0), 'poison anoint fixture must have meaningful damage gains');
  assert.deepEqual(itemIdentity(await client.getItems()), originalItems, 'anoint simulation changed equipped items');
  const afterAnointStats = await client.getStats(['Life', 'MinionTotalDPS', 'MinionCombinedDPS']);
  assert.deepEqual(afterAnointStats, originalAnointStats, 'anoint simulation changed calculated stats');
  assert.deepEqual(await client.getTree(), originalAnointTree, 'anoint simulation changed passive tree');
  const minionItemText = `${amuletText}\nMinions deal 40% increased Damage`;
  const minionPreview = await client.compareItem('Amulet', minionItemText);
  assert.ok(minionPreview.baseline.MinionCombinedDPS > 0 && minionPreview.candidateStats.MinionCombinedDPS > minionPreview.baseline.MinionCombinedDPS, 'item preview must include poison-inclusive minion damage');
  assert.deepEqual(itemIdentity(await client.getItems()), originalItems, 'minion item preview changed equipped items');
  await client.addItem(minionItemText, 'Amulet');
  const actualMinionItem = await client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
  for (const key of ['MinionTotalDPS', 'MinionCombinedDPS']) {
    assert.ok(Math.abs(actualMinionItem[key] - minionPreview.candidateStats[key]) < 0.01, `minion item preview ${key} disagrees with actual equipment`);
  }
  console.log(JSON.stringify({ spellDps: spell.TotalDPS, minionDps: minion.MinionTotalDPS, jewels: jewels.length }));
} finally {
  await client.stop();
}
