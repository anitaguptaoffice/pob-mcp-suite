import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { StatDefinition } from '../../types/tradeTypes.js';
import { isDeepStrictEqual } from 'node:util';

export function tradeMetadataSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'search_trade_stats', description: 'Search official Trade stat text and return IDs grouped by identical text and source. Does not prove item applicability.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] } },
    { name: 'list_trade_leagues', description: 'List leagues from official international Trade metadata.', inputSchema: { type: 'object', properties: {} } },
  ];
}

export function createTradeMetadataTools(source: OfficialTradeSource): FeatureTool[] {
  const schemas = tradeMetadataSchemas();
  return [{ schema: schemas[0], invoke: async args => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const limit = args.limit === undefined ? 10 : args.limit;
    if (!query || query.length > 200 || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('A non-empty query and limit from 1 to 50 are required');
    const response = await source.stats();
    if (response.source !== 'official-trade' || response.request.kind !== 'stats' || !Number.isFinite(Date.parse(response.fetchedAt))) throw new Error('Official Trade returned invalid stat provenance');
    const normalized = query.toLowerCase();
    const terms = normalized.split(/\s+/);
    const byText = new Map<string, StatDefinition[]>();
    for (const category of response.data.result) for (const entry of category.entries) {
      if (!terms.every(term => entry.text.toLowerCase().includes(term))) continue;
      const group = byText.get(entry.text) ?? [];
      if (!group.some(existing => existing.id === entry.id && existing.type === entry.type && isDeepStrictEqual(existing.option, entry.option))) group.push(entry);
      byText.set(entry.text, group);
    }
    const texts = [...byText.keys()].sort((a, b) => {
      const rank = (text: string) => text.toLowerCase() === normalized ? 0 : text.toLowerCase().startsWith(normalized) ? 1 : 2;
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    const results = texts.slice(0, limit).map(text => ({ text, sources: byText.get(text)!.map(({ id, type, option }) => ({ id, type, ...(option ? { option } : {}) })) }));
    return { content: [{ type: 'text', text: JSON.stringify({ source: response.source, fetchedAt: response.fetchedAt, query, totalTexts: texts.length, truncated: texts.length > limit, results,
      warnings: ['IDs with the same text may have different item applicability; verify sources before constructing the query.'] }) }] };
  } }, { schema: schemas[1], invoke: async () => {
    const response = await source.leagues();
    if (response.source !== 'official-trade' || response.request.kind !== 'leagues' || !Number.isFinite(Date.parse(response.fetchedAt))) throw new Error('Official Trade returned invalid league provenance');
    return { content: [{ type: 'text', text: JSON.stringify({ source: response.source, fetchedAt: response.fetchedAt, leagues: response.data.result }) }] };
  } }];
}
