import { readFileSync } from 'node:fs';
import { decodeOfficialTreeCode } from '../../src/adapters/pob/officialTreeCode.js';

it('decodes the PoB fixture official version-4 URL without inventing its tree version or start nodes', () => {
  const xml = readFileSync('tests/fixtures/occ-vortex.xml', 'utf8');
  const spec = xml.match(/<Spec\b[^>]*nodes="([^"]+)"[^>]*classId="(\d+)"[^>]*>[\s\S]*?<URL>\s*(https:\/\/www\.pathofexile\.com\/passive-skill-tree\/[^\s<]+)/);
  expect(spec).not.toBeNull();
  const result = decodeOfficialTreeCode(spec![3]);
  expect(result).toMatchObject({ formatVersion: 4, classId: 3, ascendClassId: 1, secondaryAscendClassId: 0, treeVersion: null, startNodesInferred: false, masteryEffects: {} });
  const serializedNodes = spec![1].split(',').map(Number);
  expect(result.nodes.every(node => serializedNodes.includes(node))).toBe(true);
  expect(serializedNodes.filter(node => !result.nodes.includes(node))).toEqual(expect.arrayContaining([18378, 54447]));
  expect(serializedNodes.length - result.nodes.length).toBe(2);
  expect(decodeOfficialTreeCode(spec![3].split('/').pop()!)).toEqual(result);
});

it('decodes version 6 ordinary, cluster, and mastery IDs in PoB byte order', () => {
  const bytes = Buffer.from([0, 0, 0, 6, 3, 9, 2, 0, 42, 1, 44, 1, 0, 2, 1, 0, 9, 0, 42]);
  expect(decodeOfficialTreeCode(bytes.toString('base64url'))).toEqual({ formatVersion: 6, classId: 3, ascendClassId: 1, secondaryAscendClassId: 2, nodes: [42, 300, 65538], masteryEffects: { '42': 9 }, treeVersion: null, startNodesInferred: false });
});

it('rejects truncated, ambiguous, unsupported and non-official inputs', () => {
  const code = (bytes: number[]) => Buffer.from(bytes).toString('base64url');
  for (const input of ['https://example.com/passive-skill-tree/AAAA', 'https://www.pathofexile.com/passive-skill-tree/AAAA?x=1', 'invalid!', code([0, 0, 0, 7, 1, 0]), code([0, 0, 0, 6, 1, 0, 1, 0]), code([0, 0, 0, 4, 1, 0, 0, 0]), code([0, 0, 0, 4, 1, 0, 0, 0, 1, 0, 1]), code([0, 0, 0, 6, 1, 0, 1, 0, 1, 0, 1, 0, 2, 0, 3])]) {
    expect(() => decodeOfficialTreeCode(input)).toThrow();
  }
});
