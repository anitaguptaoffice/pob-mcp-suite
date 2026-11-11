import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeClusterFile, createClusterFileTool } from '../../src/features/clusterAnalysis/fileTool.js';

const fixture = readFileSync(resolve('tests/fixtures/cluster-toxic-rain.xml'), 'utf8');
it('uses the active spec and actual socket assignments, rather than every item in the file', () => {
  const result = analyzeClusterFile(fixture);
  expect(result.activeSpec).toBe(3); expect(result.treeVersion).toBe('3_13'); expect(result.socketDataAvailable).toBe(true);
  expect(result.jewels).toHaveLength(11);
  const jewel = result.jewels.find(j => j.socketNodeId === 21984)!;
  expect(jewel).toMatchObject({ itemId: 27, baseName: 'Large Cluster Jewel', nodeCount: 8, serializedNodePresent: true });
  expect(jewel.listedNotableNames).toEqual(expect.arrayContaining(['Wicked Pall', 'Misery Everlasting']));
  expect(jewel.allocated).toBeUndefined();
});
it('reports missing socket data and unresolved item references explicitly', () => {
  const empty = '<PathOfBuilding><Tree><Spec treeVersion="x"/></Tree><Items/></PathOfBuilding>';
  expect(analyzeClusterFile(empty)).toMatchObject({ socketDataAvailable: false, jewels: [], unresolvedSockets: [] });
  const unresolved = '<PathOfBuilding><Tree><Spec><Sockets><Socket nodeId="1" itemId="99"/></Sockets></Spec></Tree><Items/></PathOfBuilding>';
  expect(analyzeClusterFile(unresolved).unresolvedSockets).toEqual([{ socketNodeId: 1, itemId: 99 }]);
});
it('rejects malformed XML, ambiguous IDs, and external entity declarations', () => {
  for (const xml of ['<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><PathOfBuilding/>', '<PathOfBuilding>', '<PathOfBuilding><Tree activeSpec="2"><Spec/></Tree><Items/></PathOfBuilding>', '<PathOfBuilding><Tree><Spec/></Tree><Items><Item id="1">x</Item><Item id="1">y</Item></Items></PathOfBuilding>']) expect(() => analyzeClusterFile(xml)).toThrow();
});
it('returns an XML fingerprint and never reads invalid options', async () => {
  const read = jest.fn().mockResolvedValue(fixture), tool = createClusterFileTool(read);
  const result = JSON.parse((await tool.invoke({ build_name: 'example.xml' })).content[0].text);
  expect(result.source).toBe('local_saved_xml'); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(tool.invoke({ build_name: '' })).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
});
