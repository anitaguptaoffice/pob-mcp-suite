import assert from 'node:assert/strict';
import { PoBLuaApiClient } from '../build/pobLuaBridge.js';

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

  const jewels = await client.findTimelessJewelSeeds({
    socketNodeId: 60735, desired: ['eternal_notable_minion_1'], seeds: [130660],
  });
  assert.ok(jewels.some((result) => result.seed === 130660 && result.hits.length > 0), 'jewel lookup failed');
  console.log(JSON.stringify({ spellDps: spell.TotalDPS, minionDps: minion.MinionTotalDPS, jewels: jewels.length }));
} finally {
  await client.stop();
}
