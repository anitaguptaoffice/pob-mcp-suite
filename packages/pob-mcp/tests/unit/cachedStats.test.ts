import { createCachedStatsTool, parseCachedStats } from '../../src/features/cachedStats/tool.js';

const xml = '<PathOfBuilding><Build><PlayerStat stat="Life" value="1.00"/><PlayerStat stat="Life" value="2"/><PlayerStat value="?"/><MinionStat stat="DPS" value="3"/></Build></PathOfBuilding>';
it('preserves serialized order, duplicates, raw values and missing attributes', () => {
  expect(parseCachedStats(xml)).toEqual([
    { source: 'PlayerStat', stat: 'Life', value: '1.00' }, { source: 'PlayerStat', stat: 'Life', value: '2' },
    { source: 'PlayerStat', stat: null, value: '?' }, { source: 'MinionStat', stat: 'DPS', value: '3' },
  ]);
  expect(parseCachedStats('<PathOfBuilding><Build/></PathOfBuilding>')).toEqual([]);
  for (const input of ['<PathOfBuilding><Build></PathOfBuilding>', '<!DOCTYPE x [<!ENTITY foo "test">]><PathOfBuilding><Build/></PathOfBuilding>', '<PathOfBuilding><Build/><Build/></PathOfBuilding>']) expect(() => parseCachedStats(input)).toThrow();
});

it('requires a matching file fingerprint to continue pagination', async () => {
  let current = xml;
  const tool = createCachedStatsTool('local', async () => current);
  const first = JSON.parse((await tool.invoke({ build_name: 'build.xml', limit: 2 })).content[0].text);
  expect(first.total).toBe(4); expect(first.nextOffset).toBe(2);
  const second = JSON.parse((await tool.invoke({ build_name: 'build.xml', limit: 2, offset: first.nextOffset, xml_fingerprint: first.xmlFingerprint })).content[0].text);
  expect(second.entries).toEqual(parseCachedStats(xml).slice(2)); expect(second.nextOffset).toBeNull();
  current += '\n';
  await expect(tool.invoke({ build_name: 'build.xml', offset: 2, xml_fingerprint: first.xmlFingerprint })).rejects.toThrow('changed');
  await expect(tool.invoke({ build_name: 'build.xml', offset: 2 })).rejects.toThrow('Invalid');
});

it('reads only an explicit snapshot and reports the source', async () => {
  const read = jest.fn(async () => xml), id = 'a'.repeat(64);
  const tool = createCachedStatsTool('snapshot', read);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(result).toMatchObject({ source: 'snapshot_xml', snapshotId: id, total: 4 });
  expect(read).toHaveBeenCalledWith(id);
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Invalid');
});
