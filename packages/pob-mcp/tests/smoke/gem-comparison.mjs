// Compare the isolated gem tool with independently applied PoB changes.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LuaClientManager } from '../../build/server/luaClientManager.js';
import { compareGemSetups } from '../../build/features/gemComparison/compare.js';
import { rankSupportGems } from '../../build/features/supportRanking/rank.js';

// Unlike the production entrypoint, this direct bridge test must set the repo root.
process.env.POB_REPO_ROOT ??= resolve('.');

const dir = await mkdtemp(join(tmpdir(), 'pob-gem-compare-'));
const fixture = resolve('tests/fixtures/occ-vortex.xml');
await cp(fixture, join(dir, 'vortex.xml'));
const factory = async () => {
  const manager = new LuaClientManager(true);
  try {
    await manager.ensureClient();
    return { client: manager.getClient(), close: () => manager.stopClient() };
  } catch (error) { await manager.stopClient(); throw error; }
};
const context = { pobDirectory: dir, createIsolatedLuaClient: factory };
const args = { build_name: 'vortex.xml', setups: [
  { name: 'efficacy', gems: ['Vortex', 'Efficacy'] },
  { name: 'controlled', gems: ['Vortex', 'Controlled Destruction'] },
  { name: 'incompatible', gems: ['Vortex', 'Minion Damage'] },
] };
try {
  const result = await compareGemSetups(context, args);
  assert.equal(result.activeGem, 'Vortex');
  assert.equal(result.mainGroup, 5);
  assert.equal(result.setups[0].gems.find(g => g.name === 'Efficacy').appliedToSelectedSkill, true, 'compatible support should apply');
  assert.equal(result.setups[2].gems.find(g => g.name === 'Minion Damage').appliedToSelectedSkill, false, 'incompatible support should be reported');
  const direct = await factory();
  try {
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    const group = (await direct.client.getSkills()).groups.find(g => g.index === 5);
    await assert.rejects(direct.client.addGem({ groupIndex: 5, gemName: 'Not A Real Gem' }), /unrecognized gem/);
    assert.deepEqual((await direct.client.getSkills()).groups.find(g => g.index === 5).gems.map(g => g.name), group.gems.map(g => g.name), 'invalid gem must not mutate the group');
    await direct.client.addGem({ groupIndex: 5, gemName: 'eFFicAcy SuPport', level: 20 });
    const alias = (await direct.client.getSkills()).groups.find(g => g.index === 5).gems.at(-1);
    assert.equal(alias.name, 'Efficacy', 'official support alias should resolve to the canonical PoB name');
    assert.equal(alias.isSupport, true);
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    await assert.rejects(direct.client.addGem({ groupIndex: 5, gemName: 'Added Cold Damage', insertIndex: 0 }), /insertIndex/);
    assert.deepEqual((await direct.client.getSkills()).groups.find(g => g.index === 5).gems.map(g => g.name), group.gems.map(g => g.name), 'invalid position must not mutate the group');
    const compatible = await direct.client.getCompatibleSupports({ groupIndex: 5, query: 'Efficacy', limit: 25 });
    assert.ok(compatible.candidates.some(g => g.name === 'Efficacy'), `expected compatible Efficacy: ${JSON.stringify(compatible)}`);
    const incompatible = await direct.client.getCompatibleSupports({ groupIndex: 5, query: 'Minion Damage', limit: 25 });
    assert.ok(!incompatible.candidates.some(g => g.name === 'Minion Damage'), `incompatible support leaked into candidates: ${JSON.stringify(incompatible)}`);
    assert.equal(compatible.failed, 0, 'compatibility predicate failed on matching candidates');
    const unchangedNames = group.gems.filter(g => g.enabled).map(g => g.name);
    const roundTrip = await compareGemSetups(context, { build_name: 'vortex.xml', setups: [
      { name: 'unchanged', gems: unchangedNames }, { name: 'same-again', gems: unchangedNames },
    ] });
    assert.deepEqual(roundTrip.setups[0].stats, roundTrip.baseline, 'rebuilding the same setup must preserve every damage metric');
    const overridden = await compareGemSetups(context, { build_name: 'vortex.xml', setups: [
      { name: 'changed', gems: unchangedNames, gem_overrides: { Vortex: { level: 20 }, Efficacy: { quality: 30 } } },
      { name: 'original', gems: unchangedNames },
    ] });
    const vortexIndex = group.gems.find(g => g.name === 'Vortex').index;
    const efficacyIndex = group.gems.find(g => g.name === 'Efficacy').index;
    await direct.client.setGemLevel({ groupIndex: 5, gemIndex: vortexIndex, level: 20 });
    await direct.client.setGemQuality({ groupIndex: 5, gemIndex: efficacyIndex, quality: 30 });
    const changedStats = await direct.client.getStats(['CombinedDPS', 'TotalDPS']);
    assert.equal(overridden.setups[0].stats.CombinedDPS, changedStats.CombinedDPS, 'gem override must match a direct PoB edit');
    assert.equal(overridden.setups[0].stats.TotalDPS, changedStats.TotalDPS, 'gem override must match a direct PoB edit');
    assert.notEqual(overridden.setups[0].stats.CombinedDPS, overridden.setups[1].stats.CombinedDPS, 'override fixture must change the result');
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    const swappedNames = unchangedNames.map(name => name === 'Hypothermia' ? 'Added Cold Damage' : name);
    const swapped = await compareGemSetups(context, { build_name: 'vortex.xml', setups: [
      { name: 'swapped', gems: swappedNames }, { name: 'original', gems: unchangedNames },
    ] });
    assert.equal(swapped.setups[0].gems.find(g => g.name === 'Added Cold Damage').groupPosition, 1, 'replacement must keep the original slot position');
    assert.equal(swapped.setups[0].gems.find(g => g.name === 'Vortex').groupPosition, 6, 'unaffected active gem must keep its position');
    await direct.client.removeGem({ groupIndex: 5, gemIndex: 1 });
    await direct.client.addGem({ groupIndex: 5, gemName: 'Added Cold Damage', level: 20, quality: 0, insertIndex: 1 });
    const swappedStats = await direct.client.getStats(['CombinedDPS', 'TotalDPS']);
    assert.equal(swapped.setups[0].stats.CombinedDPS, swappedStats.CombinedDPS, 'replacement must match a direct edit at the same position');
    const ranked = await rankSupportGems(context, { build_name: 'vortex.xml', replace_gem: 'Hypothermia',
      candidates: ['Hypothermia', 'Added Cold Damage', 'Minion Damage'], damage_metric: 'CombinedDPS' });
    assert.equal(ranked.ranked.find(candidate => candidate.gem === 'Added Cold Damage')?.damage, swappedStats.CombinedDPS);
    assert.ok(ranked.unranked.some(candidate => candidate.gem === 'Minion Damage'), 'incompatible support must not be ranked');
    assert.equal(ranked.ranked.find(candidate => candidate.gem === 'Hypothermia')?.delta, 0, 'unchanged candidate must be neutral');
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    await direct.client.removeGem({ groupIndex: 5, gemIndex: 1 });
    await direct.client.addGem({ groupIndex: 5, gemName: 'Added Cold Damage', level: 20, quality: 0 });
    const appendedStats = await direct.client.getStats(['CombinedDPS']);
    assert.notEqual(appendedStats.CombinedDPS, swappedStats.CombinedDPS, 'fixture must expose the socket-order damage difference');
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    for (let i = group.gems.length - 1; i >= 0; i--) {
      if (!['Vortex', 'Efficacy'].includes(group.gems[i].name)) await direct.client.removeGem({ groupIndex: 5, gemIndex: i + 1 });
    }
    const stats = await direct.client.getStats(['CombinedDPS', 'TotalDPS']);
    assert.equal(result.setups[0].stats.CombinedDPS, stats.CombinedDPS);
    assert.equal(result.setups[0].stats.TotalDPS, stats.TotalDPS);
    assert.ok(stats.CombinedDPS > 0 || stats.TotalDPS > 0, 'control needs non-zero damage');
  } finally { await direct.close(); }
  await assert.rejects(compareGemSetups(context, { ...args, setups: [
    { name: 'invalid', gems: ['Vortex', 'Not A Real Support'] }, args.setups[1],
  ] }), /unrecognized gem/);
  const poison = await factory();
  try {
    await poison.client.newBuild({ className: 'Witch' });
    await poison.client.setTree({ classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
    await poison.client.createSocketGroup({ label: 'minion', slot: 'Helmet' });
    await poison.client.addGem({ groupIndex: 1, gemName: 'Summon Raging Spirit', level: 20 });
    await poison.client.setMainSelection({ mainSocketGroup: 1 });
    await poison.client.setConfig({ customMods: 'Minions have 100% chance to Poison on Hit' });
    const supports = await poison.client.getCompatibleSupports({ groupIndex: 1, query: 'Minion Damage', limit: 25 });
    assert.ok(supports.candidates.some(g => g.name === 'Minion Damage'), `minion damage must support SRS: ${JSON.stringify(supports)}`);
    assert.equal(supports.failed, 0);
    const poisonXml = await poison.client.exportBuildXml();
    await writeFile(join(dir, 'poison.xml'), poisonXml);
    const result = await compareGemSetups(context, { build_name: 'poison.xml', setups: [
      { name: 'alone', gems: ['Summon Raging Spirit'] },
      { name: 'minion damage', gems: ['Summon Raging Spirit', 'Minion Damage'] },
    ] });
    assert.equal(result.setups[1].gems.find(g => g.name === 'Minion Damage').appliedToSelectedSkill, true, 'minion support should apply to the selected minion skill');
    assert.ok(result.setups[0].stats.MinionCombinedDPS > result.setups[0].stats.MinionTotalDPS,
      'poison damage must be included in the minion combined metric');
    await poison.client.addGem({ groupIndex: 1, gemName: 'Minion Damage', level: 20, quality: 0 });
    const direct = await poison.client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
    assert.equal(result.setups[1].stats.MinionCombinedDPS, direct.MinionCombinedDPS);
    assert.equal(result.setups[1].stats.MinionTotalDPS, direct.MinionTotalDPS);
    await writeFile(join(dir, 'poison-ranked.xml'), await poison.client.exportBuildXml());
    const poisonRanked = await rankSupportGems(context, { build_name: 'poison-ranked.xml', replace_gem: 'Minion Damage',
      candidates: ['Minion Damage', 'Faster Casting'], damage_metric: 'MinionCombinedDPS' });
    assert.equal(poisonRanked.metric, 'MinionCombinedDPS');
    assert.equal(poisonRanked.ranked.find(candidate => candidate.gem === 'Minion Damage')?.damage, direct.MinionCombinedDPS);
    assert.equal(poisonRanked.ranked.find(candidate => candidate.gem === 'Minion Damage')?.delta, 0);
  } finally { await poison.close(); }
  console.log('gem comparison passed: isolated PoB result equals an independently applied setup; invalid gem rejected; poison minion metrics match direct PoB');
} finally { await rm(dir, { recursive: true, force: true }); }
