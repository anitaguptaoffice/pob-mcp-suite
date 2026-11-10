import { deflateSync, deflateRawSync } from 'node:zlib';
import { decodeShareCode, MAX_BUILD_BYTES } from '../../src/foundation/shareCode.js';

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
});
