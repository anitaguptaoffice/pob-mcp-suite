import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildXml } from '../../src/utils/buildXml.js';
import { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import { SnapshotStore } from '../../src/foundation/snapshotStore.js';

it('detects non-default gem qualities in every skill set without matching notes or comments', () => {
  expect(new BuildXml('<PathOfBuilding><Notes>qualityId="Anomalous"</Notes><Skills><Skill><Gem qualityId="Default"/></Skill></Skills></PathOfBuilding>').hasNonDefaultGemQuality()).toBe(false);
  expect(new BuildXml('<PathOfBuilding><Skills><SkillSet id="1"><Skill><Gem/></Skill></SkillSet><SkillSet id="2"><Skill><Gem qualityId="Anomalous"/></Skill></SkillSet></Skills></PathOfBuilding>').hasNonDefaultGemQuality()).toBe(true);
  expect(new BuildXml('<PathOfBuilding><Skills><!-- <Gem qualityId="Anomalous"/> --><Skill><Gem qualityId=""/></Skill></Skills></PathOfBuilding>').hasNonDefaultGemQuality()).toBe(true);
});

it('refuses unrelated mutations before opening PoB and leaves the original snapshot intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pob-gem-quality-'));
  try {
    const xml = '<PathOfBuilding><Skills><SkillSet id="2"><Skill><Gem qualityId="Anomalous"/></Skill></SkillSet></Skills></PathOfBuilding>';
    const store = new SnapshotStore(dir);
    const parent = await store.create({ xml, source: 'fixture', parentId: null, engineVersion: null, dataVersion: null, adapterVersion: null });
    const open = jest.fn();
    const foundation = new BuildFoundation(store, open);
    await expect(foundation.deriveLevel(parent.id, 70)).rejects.toThrow('non-default gem qualityId');
    await expect(foundation.deriveNotes(parent.id, 'changed')).rejects.toThrow('non-default gem qualityId');
    expect(open).not.toHaveBeenCalled();
    expect((await store.read(parent.id)).xml).toBe(xml);
    expect((await foundation.listSnapshots()).snapshots.map(record => record.id)).toEqual([parent.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
