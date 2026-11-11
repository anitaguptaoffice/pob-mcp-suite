import { deflateSync, deflateRawSync } from 'node:zlib';
import { decodeShareCode, MAX_BUILD_BYTES } from '../../src/foundation/shareCode.js';
import { readFileSync } from 'node:fs';

describe('PoB share code decoding', () => {
  it('accepts compressed URL-safe codes, with or without padding', () => {
    const xml = '<PathOfBuilding><Build level="1"/></PathOfBuilding>';
    for (const compressed of [deflateSync(xml), deflateRawSync(xml)]) {
      const code = compressed.toString('base64url');
      expect(decodeShareCode(code)).toBe(xml);
      expect(decodeShareCode(code + '='.repeat((4 - code.length % 4) % 4))).toBe(xml);
    }
  });
  it('rejects invalid, non-UTF8 and excessively expanded input', () => {
    expect(() => decodeShareCode('invalid!')).toThrow();
    expect(() => decodeShareCode(deflateSync(Buffer.from([0xff])).toString('base64url'))).toThrow('UTF-8');
    expect(() => decodeShareCode(deflateSync(Buffer.alloc(MAX_BUILD_BYTES + 1)).toString('base64url'))).toThrow('size limit');
  });
  it('rejects an official passive-tree URL and its uncompressed code', () => {
    const xml = readFileSync('tests/fixtures/cluster-toxic-rain.xml', 'utf8');
    const url = xml.match(/https:\/\/www\.pathofexile\.com\/passive-skill-tree\/[A-Za-z0-9_=-]+/)?.[0];
    expect(url).toBeDefined();
    expect(() => decodeShareCode(url!)).toThrow('Invalid');
    expect(() => decodeShareCode(url!.split('/').pop()!)).toThrow('decompressed');
  });
});
