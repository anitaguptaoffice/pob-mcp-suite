import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { MAX_BUILD_BYTES } from '../../foundation/shareCode.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Preserve order, duplicates and exact serialized values; these are not PoB calculations. */
export function parseCachedStats(xml: string) {
  if (!xml || Buffer.byteLength(xml, 'utf8') > MAX_BUILD_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsupported build XML');
  const document: unknown = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false, trimValues: false }).parse(xml);
  const root = object(document) ? document.PathOfBuilding : undefined;
  const rawBuild = object(root) ? root.Build : undefined;
  const build = rawBuild === '' ? {} : rawBuild;
  if (!object(build)) throw new Error('Build XML must have exactly one Build element');
  const entries: Array<{ source: 'PlayerStat' | 'MinionStat'; stat: string | null; value: string | null }> = [];
  for (const source of ['PlayerStat', 'MinionStat'] as const) for (const row of array(build[source])) {
    entries.push({ source, stat: object(row) && typeof row['@_stat'] === 'string' ? row['@_stat'] : null, value: object(row) && typeof row['@_value'] === 'string' ? row['@_value'] : null });
  }
  return entries;
}

export function cachedStatsSchema(kind: 'local' | 'snapshot'): FeatureTool['schema'] {
  const key = kind === 'local' ? 'build_name' : 'snapshot_id';
  return { name: kind === 'local' ? 'inspect_local_cached_stats' : 'inspect_snapshot_cached_stats', description: 'Read serialized historical PoB PlayerStat and MinionStat values; these are not current calculations.', inputSchema: { type: 'object', additionalProperties: false, properties: { [key]: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 }, offset: { type: 'integer', minimum: 0 }, xml_fingerprint: { type: 'string' } }, required: [key] } };
}

export function createCachedStatsTool(kind: 'local' | 'snapshot', read: (name: string) => Promise<string>): FeatureTool {
  const key = kind === 'local' ? 'build_name' : 'snapshot_id';
  return { schema: cachedStatsSchema(kind), invoke: async args => {
    const name = args[key], limit = args.limit ?? 100, offset = args.offset ?? 0, fingerprint = args.xml_fingerprint;
    if (Object.keys(args).some(k => ![key, 'limit', 'offset', 'xml_fingerprint'].includes(k)) || typeof name !== 'string' || !name.trim() || name.length > 4096 || (kind === 'snapshot' && !/^[a-f0-9]{64}$/.test(name)) || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || (fingerprint !== undefined && (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint))) || (offset > 0 && fingerprint === undefined)) throw new Error('Invalid cached stats options');
    const xml = await read(name), xmlFingerprint = createHash('sha256').update(xml).digest('hex');
    if (fingerprint !== undefined && fingerprint !== xmlFingerprint) throw new Error('Build XML changed; restart pagination');
    const entries = parseCachedStats(xml);
    if (offset > entries.length) throw new Error('Cached stats offset is outside the serialized entries');
    const page = entries.slice(offset, offset + limit);
    return { content: [{ type: 'text', text: JSON.stringify({ source: kind === 'local' ? 'local_saved_xml' : 'snapshot_xml', [kind === 'local' ? 'buildName' : 'snapshotId']: name, xmlFingerprint, total: entries.length, offset, entries: page, nextOffset: offset + page.length < entries.length ? offset + page.length : null, warnings: ['Serialized historical values may be stale or absent and do not represent a current PoB calculation. Use a snapshot evaluation for current stats.', 'Duplicate names are preserved in serialized order within each stat type. Missing names or values are null; the raw values are not interpreted.'] }) }] };
  } };
}
