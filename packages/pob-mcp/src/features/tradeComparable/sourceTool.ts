import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { comparableQuerySchema } from './querySchema.js';
import { estimateComparable } from './pricingPolicy.js';
import { TrackedTrade } from '../tradeCommon/trackedTrade.js';

export function sourceComparableSchema(): FeatureTool['schema'] {
  return comparableQuerySchema('estimate_trade_comparable', 'Compare official international instant-buyout listings using confirmed base and stat groups. Reports retrieval times and source coverage; not an exact appraisal.');
}

/** Compose explicit pricing policy with the independently replaceable source. */
export function createSourceComparableTool(source: OfficialTradeSource): FeatureTool {
  return { schema: sourceComparableSchema(), invoke: async args => {
    const client = new TrackedTrade(source);
    const report = await estimateComparable(client, args);
    return { content: [{ type: 'text', text: JSON.stringify({ ...report, source: 'official-trade', sourceTimes: client.sourceTimes, sourceFailures: client.sourceFailures, missingListingIds: client.missingIds,
      warnings: [...report.warnings, ...(client.missingIds.length ? ['Some requested listings were unavailable at fetch time; sample statistics are partial.'] : [])] }) }] };
  } };
}
