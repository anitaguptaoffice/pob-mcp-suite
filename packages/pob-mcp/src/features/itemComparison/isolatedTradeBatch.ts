import type { PoBLuaApiClient } from '../../pobLuaBridge.js';
import type { TradeApiClient } from '../../services/tradeClient.js';
import { compareTradeListings, validateTradeBatchArgs } from './tradeBatch.js';

interface SnapshotContext {
  live: Pick<PoBLuaApiClient, 'itemComparisonSnapshot'>;
  createIsolated: () => Promise<{ client: Pick<PoBLuaApiClient, 'loadBuildXml' | 'compareItem'>; close: () => Promise<void> }>;
}

/** Strict key parity plus a small floating-point tolerance; missing metrics are not zero. */
function sameMetrics(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a).sort();
  if (!keys.length || keys.join('\0') !== Object.keys(b).sort().join('\0')) return false;
  return keys.every(key => Number.isFinite(a[key]) && Number.isFinite(b[key]) && Math.abs(a[key] - b[key]) <= 1e-9 * Math.max(1, Math.abs(a[key]), Math.abs(b[key])));
}

export async function compareTradeListingsSnapshot(trade: Pick<TradeApiClient, 'fetchItems'>, context: SnapshotContext, args: Record<string, unknown>) {
  validateTradeBatchArgs(args);
  const snapshot = await context.live.itemComparisonSnapshot();
  if (!snapshot || typeof snapshot.xml !== 'string' || !snapshot.xml.trim() || !snapshot.baseline || !Object.keys(snapshot.baseline).length) throw new Error('live PoB snapshot is incomplete');
  const isolated = await context.createIsolated();
  try {
    await isolated.client.loadBuildXml(snapshot.xml, 'item-comparison-snapshot');
    const batch = await compareTradeListings(trade, isolated.client, args);
    let snapshotBaselineMismatchCount = 0;
    const results = batch.results.map(row => {
      if (row.status === 'error') return row;
      if (!sameMetrics(snapshot.baseline, row.result.baseline)) {
        snapshotBaselineMismatchCount++;
        return { itemId: row.itemId, status: 'error' as const, error: 'isolated PoB baseline does not match the captured live snapshot; comparison was discarded' };
      }
      return { ...row, result: { ...row.result, source: 'live_snapshot_isolated_pob',
        warnings: row.result.warnings.map(warning => warning.replace('current build, selected skills and configuration', 'captured live build, selected skills and configuration')) } };
    });
    return { ...batch, source: 'live_snapshot_isolated_pob', snapshotBaselineMismatchCount, completedCount: results.filter(row => row.status === 'ok').length, results,
      warnings: [
        'All candidates use one captured live-build snapshot in a separate PoB engine; later edits to the live build are not included.',
        'Each returned baseline is checked against the captured numeric metrics. Matching metrics do not prove every non-numeric setting or mechanic survived serialization.',
        'Prices remain in their original currencies; listing details can be cached, and instant-buyout status is not inferred from price.',
      ] };
  } finally { await isolated.close(); }
}
