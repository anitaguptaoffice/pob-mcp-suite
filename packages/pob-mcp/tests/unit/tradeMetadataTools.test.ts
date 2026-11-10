import { createTradeMetadataTools } from '../../src/features/tradeMetadata/tools.js';
import type { OfficialTradeSource } from '../../src/ports/officialTrade.js';

describe('official trade metadata tools', () => {
  it('groups identical text by source, retains options, and reports truncation', async () => {
    const source = { stats: async () => ({ source: 'official-trade', fetchedAt: '2026-01-01T00:00:00.000Z', request: { kind: 'stats' }, data: { result: [{ entries: [
      { id: 'explicit.a', text: '+# maximum Life', type: 'explicit' },
      { id: 'fractured.a', text: '+# maximum Life', type: 'fractured' },
      { id: 'explicit.b', text: 'Regenerate # Life per second', type: 'explicit', option: { options: [{ id: 1, text: 'x' }] } },
    ] }] } }) } as unknown as OfficialTradeSource;
    const tool = createTradeMetadataTools(source)[0];
    const result = JSON.parse((await tool.invoke({ query: 'life', limit: 1 })).content[0].text);
    expect(result.totalTexts).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.results[0].sources).toEqual([{ id: 'explicit.a', type: 'explicit' }, { id: 'fractured.a', type: 'fractured' }]);
    expect(result.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    await expect(tool.invoke({ query: ' ', limit: 10 })).rejects.toThrow('query');
  });

  it('returns league metadata with source time and never converts errors to an empty list', async () => {
    const source = { leagues: async () => ({ source: 'official-trade', fetchedAt: '2026-01-01T00:00:00.000Z', request: { kind: 'leagues' }, data: { result: [{ id: 'Standard', realm: 'pc' }] } }) } as unknown as OfficialTradeSource;
    const result = JSON.parse((await createTradeMetadataTools(source)[1].invoke({})).content[0].text);
    expect(result.leagues).toEqual([{ id: 'Standard', realm: 'pc' }]);
    expect(result.source).toBe('official-trade');
    const broken = { leagues: async () => { throw new Error('unavailable'); } } as unknown as OfficialTradeSource;
    await expect(createTradeMetadataTools(broken)[1].invoke({})).rejects.toThrow('unavailable');
  });
});
