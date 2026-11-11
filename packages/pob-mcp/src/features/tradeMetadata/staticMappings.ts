import { createHash } from 'node:crypto';
import type { StaticStatSource } from '../../ports/staticStatSource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function staticStatMappingSchema(): FeatureTool['schema'] {
  return { name: 'search_bundled_stat_mappings', description: 'Search the bundled PoB-name and alias mapping offline. Candidate Trade IDs are unverified and may be obsolete; consult official Trade metadata before use.', inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] } };
}

export function createStaticStatMappingTool(source: StaticStatSource): FeatureTool {
  return { schema: staticStatMappingSchema(), invoke: async args => {
    const query = typeof args.query === 'string' ? args.query.trim() : '', limit = args.limit ?? 10;
    if (Object.keys(args).some(key => !['query', 'limit'].includes(key)) || !query || query.length > 200 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('A non-empty query and limit from 1 to 50 are required');
    const catalog = source.catalog();
    const catalogDigest = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
    const matches = source.fuzzySearch(query, catalog.length);
    const results = matches.slice(0, limit).map(mapping => ({ ...mapping, officialStatus: 'unverified' }));
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'bundled_stat_aliases', catalogDigest, query, totalMatches: matches.length, truncated: matches.length > limit, results,
      warnings: ['Bundled aliases are incomplete and may contain obsolete or invalid Trade IDs; they are not official Trade metadata.', 'Confirm every candidate and its source using current official Trade metadata before constructing a trade query.', 'Fuzzy matches can be unrelated to the intended stat; item applicability is not established.'] }) }] };
  } };
}
