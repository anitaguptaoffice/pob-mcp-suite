import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { formatBaseSlug, parsePoedbText, fetchBaseModData } from '../../src/services/craftingDataService';

describe('PoEDB base-page references', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => { fetchSpy = jest.spyOn(globalThis, 'fetch'); });
  afterEach(() => fetchSpy.mockRestore());

  it('formats base names and checks the page title instead of copying arbitrary HTML', () => {
    expect(formatBaseSlug("Soldier's Helmet")).toBe("Soldier's_Helmet");
    const text = parsePoedbText('<title>Hubris Circlet - PoEDB, Path of Exile Wiki us</title><p>malicious content</p>', 'Hubris Circlet');
    expect(text).toContain('不是经验证的可制作词缀表');
    expect(text).not.toContain('malicious content');
    expect(() => parsePoedbText('<title>Just a moment...</title>', 'Hubris Circlet')).toThrow();
    expect(() => parsePoedbText('<title>Other Base - PoEDB</title>', 'Hubris Circlet')).toThrow();
  });

  it('provides English and Chinese links for a verified base page', async () => {
    fetchSpy.mockResolvedValue(new Response('<title>Hubris Circlet - PoEDB, Path of Exile Wiki us</title>'));
    const result = await fetchBaseModData('Hubris Circlet');
    expect(result.poedbUrl).toBe('https://poedb.tw/us/Hubris_Circlet');
    expect(result.modText).toContain('https://poedb.tw/cn/Hubris_Circlet');
  });

  it('reports HTTP and network failures', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not found', { status: 404 })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchBaseModData('Fake Base')).rejects.toThrow('404');
    await expect(fetchBaseModData('Hubris Circlet')).rejects.toThrow('network error');
  });
});
