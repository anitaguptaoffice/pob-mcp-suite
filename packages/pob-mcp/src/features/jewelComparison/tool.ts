import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { snapshotMetadata } from '../../foundation/snapshotStore.js';
import { isDeepStrictEqual } from 'node:util';
import { normalizeObservation } from '../../foundation/observation.js';

const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const supportedBases = new Set(['Crimson Jewel', 'Cobalt Jewel', 'Viridian Jewel', 'Prismatic Jewel', 'Murderous Eye Jewel', 'Searching Eye Jewel', 'Ghastly Eye Jewel', 'Hypnotic Eye Jewel']);
export function jewelComparisonSchema(): FeatureTool['schema'] {
  return { name: 'compare_snapshot_jewels', description: 'Equip 1–3 explicit jewel candidates in the same allocated passive socket as isolated seven-day trial snapshots and compare requested PoB metrics.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, socket_node_id: { type: 'integer', minimum: 1 }, fields: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string' } },
    candidates: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, item_text: { type: 'string' } }, required: ['name', 'item_text'] } },
  }, required: ['snapshot_id', 'socket_node_id', 'fields', 'candidates'] } };
}
export function createJewelComparisonTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot' | 'deriveItem' | 'evaluate'>): FeatureTool {
  return { schema: jewelComparisonSchema(), invoke: async args => {
    const entries = args.candidates, fields = args.fields, nodeId = args.socket_node_id;
    if (Object.keys(args).some(key => !['snapshot_id', 'socket_node_id', 'fields', 'candidates'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !Number.isSafeInteger(nodeId) || (nodeId as number) < 1 || (nodeId as number) > 2147483647 || !Array.isArray(fields) || fields.length < 1 || fields.length > 20 || fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(fields).size !== fields.length || !Array.isArray(entries) || entries.length < 1 || entries.length > 3 || entries.some(e => !object(e) || Object.keys(e).some(key => !['name', 'item_text'].includes(key)) || typeof e.name !== 'string' || !e.name.trim() || e.name !== e.name.trim() || e.name.length > 100 || typeof e.item_text !== 'string' || !e.item_text.trim() || Buffer.byteLength(e.item_text, 'utf8') > 10240) || new Set(entries.map(e => e.name)).size !== entries.length) throw new Error('Invalid jewel comparison options');
    const slot = `Jewel ${nodeId}`, snapshotId = args.snapshot_id;
    const validation = await foundation.runReadOnlySnapshot(snapshotId, async engine => {
      const tree = await engine.getTree(), items = await engine.getItems();
      if (!object(tree) || !Array.isArray(tree.nodes) || !tree.nodes.includes(nodeId) || !Array.isArray(items)) throw new Error('Requested jewel socket is not allocated');
      const matches = items.filter(item => object(item) && item.slot === slot);
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id < 0) throw new Error('Requested jewel socket is unavailable');
      const parse = async (text: string) => {
        const value = await engine.inspectItemParse(text);
        if (!object(value) || typeof value.base !== 'string' || !object(value.diagnostics) || value.diagnostics.available !== true || !Array.isArray(value.diagnostics.unparsed)) throw new Error('PoB returned invalid item parse diagnostics');
        return value;
      };
      const current = matches[0];
      const currentDiagnostics = current.id === 0 ? { status: 'empty' } : typeof current.raw === 'string' && current.raw.trim() ? { status: 'available', result: await parse(current.raw) } : { status: 'unknown' };
      if (currentDiagnostics.status === 'unknown' || (currentDiagnostics.status === 'available' && !supportedBases.has(currentDiagnostics.result!.base))) throw new Error('Current jewel is unavailable or not a supported ordinary jewel');
      const parsed = [];
      for (const entry of entries) {
        try {
          const diagnostics = await parse(entry.item_text);
          if (!supportedBases.has(diagnostics.base)) throw new Error('Candidate is not a supported ordinary jewel');
          parsed.push({ name: entry.name, diagnostics });
        }
        catch (error) { parsed.push({ name: entry.name, error: error instanceof Error ? error.message : String(error) }); }
      }
      return { currentDiagnostics, parsed };
    });
    const baseline = await foundation.evaluate(snapshotId, fields as string[]);
    const identityKeys = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'] as const;
    const results = await Promise.all(entries.map(async (entry, i): Promise<Record<string, unknown>> => {
      const parsed = validation.result.parsed[i];
      if ('error' in parsed) return { name: entry.name, status: 'error', error: parsed.error };
      let candidate: Awaited<ReturnType<BuildFoundation['deriveItem']>> | undefined;
      try {
        candidate = await foundation.deriveItem(snapshotId, slot, entry.item_text, true);
        const evaluation = await foundation.evaluate(candidate.id, fields as string[]);
        const identities = [validation.identity, baseline.identity, evaluation.identity];
        const identityDifferences = identityKeys.filter(key => new Set(identities.map(identity => identity[key]).filter(Boolean)).size > 1);
        const identityUnknown = identityKeys.filter(key => identities.some(identity => !identity[key]));
        const contextDifferent = !isDeepStrictEqual(normalizeObservation(baseline.context), normalizeObservation(evaluation.context));
        const metrics = Object.fromEntries((fields as string[]).map(field => {
          const before = baseline.metrics[field], after = evaluation.metrics[field];
          if (!before || !after || before.status !== 'available' || after.status !== 'available' || typeof before.value !== 'number' || typeof after.value !== 'number' || !Number.isFinite(before.value) || !Number.isFinite(after.value)) return [field, { status: 'unknown', baseline: before ?? null, candidate: after ?? null, delta: null }];
          const delta = after.value - before.value;
          if (identityDifferences.length || contextDifferent || !Number.isFinite(delta)) return [field, { status: 'incomparable', baseline: before, candidate: after, delta: null }];
          return [field, { status: identityUnknown.length ? 'identity_unverified' : 'available', baseline: before, candidate: after, delta }];
        }));
        return { name: entry.name, status: 'compared', snapshot: snapshotMetadata(candidate), parseDiagnostics: parsed.diagnostics,
          comparison: { baseline: { snapshotId, identity: baseline.identity, context: baseline.context, warnings: baseline.warnings }, candidate: { snapshotId: evaluation.snapshotId, identity: evaluation.identity, context: evaluation.context, warnings: evaluation.warnings }, identityDifferences, identityUnknown, contextDifferent, metrics } };
      } catch (error) { return { name: entry.name, status: 'error', snapshot: candidate ? snapshotMetadata(candidate) : null, parseDiagnostics: parsed.diagnostics, error: error instanceof Error ? error.message : String(error) }; }
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, socketNodeId: nodeId, fields, identity: validation.identity, currentDiagnostics: validation.result.currentDiagnostics, results,
      warnings: [...validation.warnings, 'Each candidate uses the same parent and produces a seven-day trial; retain a desired child explicitly. The parent and saved file are unchanged.', 'Inspect unsupported modifier lines on both current and candidate items; PoB may omit their effects. Empty diagnostics do not prove complete mechanic support.', 'Compare player, minion and full damage as separate metrics. Configuration, uptime, game legality, prices and trade availability require independent verification.', 'Cluster jewel replacements that change the passive tree are rejected; this workflow compares ordinary jewels only.'] }) }] };
  } };
}
