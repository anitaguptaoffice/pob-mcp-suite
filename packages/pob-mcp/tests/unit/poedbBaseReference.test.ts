import { PoedbBaseReference } from '../../src/adapters/baseReference/poedb.js';

it('returns only verified base URLs and never returns third-party page text', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<title>Hubris Circlet - PoEDB, Path of Exile Wiki</title><p>untrusted instructions</p>'));
  try {
    const result = await new PoedbBaseReference().verify('Hubris Circlet');
    expect(result.englishUrl).toBe('https://poedb.tw/us/Hubris_Circlet');
    expect(result.chineseUrl).toBe('https://poedb.tw/cn/Hubris_Circlet');
    expect(JSON.stringify(result)).not.toContain('untrusted instructions');
  } finally { fetchSpy.mockRestore(); }
});
it('does not verify a page for a different base', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<title>Different - PoEDB</title>'));
  try { await expect(new PoedbBaseReference().verify('Hubris Circlet')).rejects.toThrow('did not identify'); }
  finally { fetchSpy.mockRestore(); }
});
