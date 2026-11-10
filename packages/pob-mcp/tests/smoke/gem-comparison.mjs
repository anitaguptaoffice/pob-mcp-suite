// Compare the isolated gem tool with independently applied PoB changes.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LuaClientManager } from '../../build/server/luaClientManager.js';
import { compareGemSetups } from '../../build/features/gemComparison/compare.js';

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
] };
try {
  const result = await compareGemSetups(context, args);
  assert.equal(result.activeGem, 'Vortex');
  assert.equal(result.mainGroup, 5);
  const direct = await factory();
  try {
    await direct.client.loadBuildXml(await readFile(fixture, 'utf8'), 'control', fixture);
    const group = (await direct.client.getSkills()).groups.find(g => g.index === 5);
    const unchangedNames = group.gems.filter(g => g.enabled).map(g => g.name);
    const roundTrip = await compareGemSetups(context, { build_name: 'vortex.xml', setups: [
      { name: 'unchanged', gems: unchangedNames }, { name: 'same-again', gems: unchangedNames },
    ] });
    assert.deepEqual(roundTrip.setups[0].stats, roundTrip.baseline, 'rebuilding the same setup must preserve every damage metric');
    const overridden = await compareGemSetups(context, { build_name: 'vortex.xml', setups: [
      { name: 'changed', gems: unchangedNames, gem_overrides: { Vortex: { level: 20 }, Efficacy: { quality: 0 } } },
      { name: 'original', gems: unchangedNames },
    ] });
    const vortexIndex = group.gems.find(g => g.name === 'Vortex').index;
    const efficacyIndex = group.gems.find(g => g.name === 'Efficacy').index;
    await direct.client.setGemLevel({ groupIndex: 5, gemIndex: vortexIndex, level: 20 });
    await direct.client.setGemQuality({ groupIndex: 5, gemIndex: efficacyIndex, quality: 0 });
    const changedStats = await direct.client.getStats(['CombinedDPS', 'TotalDPS']);
    assert.equal(overridden.setups[0].stats.CombinedDPS, changedStats.CombinedDPS, 'gem override must match a direct PoB edit');
    assert.equal(overridden.setups[0].stats.TotalDPS, changedStats.TotalDPS, 'gem override must match a direct PoB edit');
    assert.notEqual(overridden.setups[0].stats.CombinedDPS, overridden.setups[1].stats.CombinedDPS, 'override fixture must change the result');
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
    const poisonXml = await poison.client.exportBuildXml();
    await writeFile(join(dir, 'poison.xml'), poisonXml);
    const result = await compareGemSetups(context, { build_name: 'poison.xml', setups: [
      { name: 'alone', gems: ['Summon Raging Spirit'] },
      { name: 'minion damage', gems: ['Summon Raging Spirit', 'Minion Damage'] },
    ] });
    assert.ok(result.setups[0].stats.MinionCombinedDPS > result.setups[0].stats.MinionTotalDPS,
      'poison damage must be included in the minion combined metric');
    await poison.client.addGem({ groupIndex: 1, gemName: 'Minion Damage', level: 20, quality: 0 });
    const direct = await poison.client.getStats(['MinionTotalDPS', 'MinionCombinedDPS']);
    assert.equal(result.setups[1].stats.MinionCombinedDPS, direct.MinionCombinedDPS);
    assert.equal(result.setups[1].stats.MinionTotalDPS, direct.MinionTotalDPS);
  } finally { await poison.close(); }
  console.log('gem comparison passed: isolated PoB result equals an independently applied setup; invalid gem rejected; poison minion metrics match direct PoB');
} finally { await rm(dir, { recursive: true, force: true }); }
