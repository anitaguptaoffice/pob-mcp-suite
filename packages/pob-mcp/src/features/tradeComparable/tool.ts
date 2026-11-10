import type { ToolSchema } from '../../server/toolSchemas.js';
import { comparableQuerySchema } from './querySchema.js';
export { estimateComparable } from './pricingPolicy.js';

/** Temporary schema for legacy clients until they migrate to the new source tool. */
export function comparableToolSchemas(): ToolSchema[] {
  return [comparableQuerySchema('estimate_comparable_item', 'Search priced international PoE 1 trade listings matching user-confirmed base and official stat groups. Returns the query, link, sample count and price statistics grouped by currency. Similar items are not an exact appraisal; find IDs with search_stats and account for explicit/implicit/fractured/crafted sources.')];
}
