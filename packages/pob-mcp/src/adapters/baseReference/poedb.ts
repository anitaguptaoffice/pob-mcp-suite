import type { BaseReferenceSource } from '../../ports/baseReferenceSource.js';

/** Only a checked page title is exposed; scraped HTML never enters the tool result. */
export class PoedbBaseReference implements BaseReferenceSource {
  async verify(base: string) {
    const slug = encodeURIComponent(base.replace(/ /g, '_'));
    const englishUrl = `https://poedb.tw/us/${slug}`;
    const response = await fetch(englishUrl, { headers: { 'User-Agent': 'pob-mcp-server/1.0 (crafting context)' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`PoEDB returned HTTP ${response.status}`);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(await response.text())?.[1]?.trim();
    if (!title || !title.toLowerCase().startsWith(`${base.toLowerCase()} - poedb`)) throw new Error('PoEDB page title did not identify the requested base');
    return { source: 'poedb' as const, base, englishUrl, chineseUrl: `https://poedb.tw/cn/${slug}` };
  }
}
