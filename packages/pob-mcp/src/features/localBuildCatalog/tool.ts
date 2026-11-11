import { createHash } from 'node:crypto';
import type { BuildFileCatalog } from '../../ports/buildFileCatalog.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function buildFileCatalogSchema(): FeatureTool['schema'] {
  return { name: 'list_local_build_files', description: 'List XML files in the configured local build directory without importing them. Restart pagination when the catalog fingerprint changes.', inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, after: { type: 'string' }, catalog_fingerprint: { type: 'string' } } } };
}
export function createBuildFileCatalogTool(catalog: BuildFileCatalog): FeatureTool {
  return { schema: buildFileCatalogSchema(), invoke: async args => {
    const limit = args.limit ?? 50;
    if (Object.keys(args).some(key => !['limit', 'after', 'catalog_fingerprint'].includes(key)) || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (args.after !== undefined && (typeof args.after !== 'string' || !args.after || args.after.length > 4096)) || (args.catalog_fingerprint !== undefined && (typeof args.catalog_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.catalog_fingerprint))) || ((args.after === undefined) !== (args.catalog_fingerprint === undefined))) throw new Error('Invalid build catalog pagination');
    const result = await catalog.scan();
    const fingerprint = createHash('sha256').update(JSON.stringify({ directory: result.directory, names: result.names, complete: result.complete, issues: result.issues })).digest('hex');
    if (args.catalog_fingerprint !== undefined && args.catalog_fingerprint !== fingerprint) throw new Error('Build catalog changed; restart pagination');
    const start = args.after === undefined ? 0 : result.names.findIndex(name => name === args.after) + 1;
    if (args.after !== undefined && start === 0) throw new Error('Build catalog cursor was not found; restart pagination');
    const names = result.names.slice(start, start + limit), nextCursor = start + names.length < result.names.length ? names.at(-1) ?? null : null;
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'local_build_directory', directory: result.directory, observedAt: new Date().toISOString(), complete: result.complete, issues: result.issues, totalObserved: result.names.length, catalogFingerprint: fingerprint, names, nextCursor, warnings: ['File discovery does not import a build or change an existing snapshot. Import a selected name explicitly.', 'The directory can change during scanning or after this result; symlinks, hidden paths and temporary files are not listed.', ...(!result.complete ? ['The listing is incomplete; inspect issues before assuming a file is absent.'] : [])] }) }] };
  } };
}
