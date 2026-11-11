import type { BuildFileWatch } from '../../ports/buildFileWatch.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function buildWatchSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'start_local_build_watch', description: 'Start observing local build-file changes without importing or modifying snapshots.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
    { name: 'stop_local_build_watch', description: 'Stop local build-file observation; already recorded events remain in this process.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
    { name: 'get_local_build_watch', description: 'Read current local build watcher state and process-local event cursor.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
    { name: 'list_local_build_changes', description: 'Read bounded, ordered file-change events. A cursor belongs to one watcher session.', inputSchema: { type: 'object', additionalProperties: false, properties: { after_sequence: { type: 'integer', minimum: 0 }, session_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  ];
}
export function createBuildWatchTools(watch: BuildFileWatch): FeatureTool[] {
  return buildWatchSchemas().map(schema => ({ schema, invoke: async args => {
    const list = schema.name === 'list_local_build_changes';
    if (Object.keys(args).some(key => !(list ? ['after_sequence', 'session_id', 'limit'] : []).includes(key))) throw new Error('Invalid build watcher options');
    let value: unknown;
    if (schema.name === 'start_local_build_watch') value = await watch.start();
    else if (schema.name === 'stop_local_build_watch') value = await watch.stop();
    else if (schema.name === 'get_local_build_watch') value = watch.status();
    else {
      const after = args.after_sequence ?? 0, limit = args.limit ?? 50, session = args.session_id, status = watch.status();
      if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0 || after > status.latestSequence || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (session !== undefined && (typeof session !== 'string' || session !== status.sessionId)) || (after > 0 && session === undefined)) throw new Error('Invalid or expired build watcher cursor');
      value = watch.changes(after, limit);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ...value as object, warnings: ['Observation is process-local and best effort; check watcher state and lostBefore before assuming events are complete.', 'File events do not import or modify snapshots. Import a chosen file explicitly to create a new snapshot.'] }) }] };
  } }));
}
