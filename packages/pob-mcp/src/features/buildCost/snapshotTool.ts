import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { EconomySource } from '../../ports/economySource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { estimateBuildCost, type CostGroup, type CostItem, type PriceSource } from './estimate.js';
import type { PriceCategory, PriceLine } from './priceTypes.js';

export function snapshotCostSchema(): FeatureTool['schema'] {
  return { name: 'estimate_snapshot_cost', description: 'Estimate an incomplete poe.ninja reference subtotal for one immutable PoB snapshot and explicit international league. These are not purchasable listings.',
    inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, league: { type: 'string' } }, required: ['snapshot_id', 'league'] } };
}

/** Translate source-native item lines at the feature boundary; reject partial schemas. */
function priceLines(value: unknown): PriceLine[] {
  const valid = (line: any) => {
    if (!line || typeof line !== 'object' || Array.isArray(line) || typeof line.name !== 'string' ||
        typeof line.chaosValue !== 'number' || !Number.isFinite(line.chaosValue) || line.chaosValue < 0) return false;
    for (const key of ['listingCount', 'count', 'gemLevel', 'gemQuality', 'links']) {
      if (line[key] != null && (typeof line[key] !== 'number' || !Number.isFinite(line[key]) || line[key] < 0)) return false;
    }
    for (const key of ['baseType', 'variant']) if (line[key] != null && typeof line[key] !== 'string') return false;
    if (line.corrupted != null && typeof line.corrupted !== 'boolean') return false;
    return line.explicitModifiers == null || (Array.isArray(line.explicitModifiers) && line.explicitModifiers.every((mod: any) =>
      mod && typeof mod === 'object' && !Array.isArray(mod) && (mod.optional == null || typeof mod.optional === 'boolean')));
  };
  if (!Array.isArray(value) || value.some(line => !valid(line))) {
    throw new Error('poe.ninja item lines have an unsupported shape');
  }
  return value as PriceLine[];
}

export function createSnapshotCostTool(foundation: Pick<BuildFoundation, 'inspect'>, economy: EconomySource): FeatureTool {
  return { schema: snapshotCostSchema(), invoke: async args => {
    const snapshotId = typeof args.snapshot_id === 'string' ? args.snapshot_id : '';
    const league = typeof args.league === 'string' ? args.league.trim() : '';
    if (!/^[a-f0-9]{64}$/.test(snapshotId) || !league || league.length > 100) throw new Error('snapshot_id and exact international league are required');
    const inspected = await foundation.inspect(snapshotId, ['items', 'skills']);
    const items = inspected.data.items;
    const skills = inspected.data.skills as { groups?: unknown } | undefined;
    if (!Array.isArray(items) || !Array.isArray(skills?.groups) || skills.groups.some(group => !group || !Array.isArray(group.gems))) {
      throw new Error('Snapshot did not provide complete item and skill-group data');
    }
    const sources: Array<{ source: string; league: string; category: PriceCategory; fetchedAt: string }> = [];
    const failures: Array<{ category: PriceCategory; message: string; code?: string; httpStatus?: number }> = [];
    const prices: PriceSource = { get: async (requestedLeague, category) => {
      try {
        const snapshot = await economy.read({ kind: 'items', league: requestedLeague, category });
        if (snapshot.source !== 'poe.ninja' || snapshot.query.kind !== 'items' || snapshot.query.league !== requestedLeague || snapshot.query.category !== category ||
            typeof snapshot.fetchedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Economy source returned mismatched provenance');
        const lines = priceLines(snapshot.payload.lines);
        sources.push({ source: snapshot.source, league: requestedLeague, category, fetchedAt: snapshot.fetchedAt });
        return { lines, fetchedAt: snapshot.fetchedAt };
      } catch (error) {
        const failure = error as { message?: string; code?: string; httpStatus?: number };
        failures.push({ category, message: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) });
        throw error;
      }
    } };
    const report = await estimateBuildCost(prices, league, items as CostItem[], skills.groups as CostGroup[]);
    sources.sort((a, b) => a.category.localeCompare(b.category));
    failures.sort((a, b) => a.category.localeCompare(b.category));
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId, identity: inspected.identity, snapshotWarnings: inspected.warnings, ...report, sources, failures }) }] };
  } };
}
