import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { searchOfficialTrade } from '../tradeSearch/tool.js';

export function tradeItemPriceSchema(): FeatureTool['schema'] {
  return { name: 'sample_trade_item_price', description: 'Sample up to ten official securable, priced listings for a confirmed item name and international league; currencies are separate and this is not a complete appraisal.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      league: { type: 'string' }, item_name: { type: 'string' }, item_type: { type: 'string' },
      rarity: { type: 'string', enum: ['normal', 'magic', 'rare', 'unique'] }, limit: { type: 'integer', minimum: 1, maximum: 10 },
    }, required: ['league', 'item_name'] } };
}

/** The source-backed search workflow owns filtering and provenance. */
export function createTradeItemPriceTool(source: OfficialTradeSource): FeatureTool {
  return { schema: tradeItemPriceSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['league', 'item_name', 'item_type', 'rarity', 'limit'].includes(key))) throw new Error('Unsupported item price option');
    if (typeof args.item_name !== 'string' || !args.item_name.trim()) throw new Error('item_name and exact international league are required');
    if (args.rarity !== undefined && !['normal', 'magic', 'rare', 'unique'].includes(args.rarity as string)) throw new Error('Invalid rarity');
    const report = await searchOfficialTrade(source, { league: args.league, item_name: args.item_name, ...(args.item_type === undefined ? {} : { item_type: args.item_type }),
      ...(args.rarity === undefined ? {} : { item_rarity: args.rarity }), status: 'securable', sale_type: 'priced', sort: 'price_asc', limit: args.limit ?? 10 });
    const prices = new Map<string, number[]>();
    for (const item of report.listings) {
      const price = item.listing.price;
      if (!price || typeof price.amount !== 'number' || !Number.isFinite(price.amount) || price.amount <= 0 || typeof price.currency !== 'string' || !price.currency.trim()) continue;
      const bucket = prices.get(price.currency) ?? [];
      bucket.push(price.amount);
      prices.set(price.currency, bucket);
    }
    const byCurrency = [...prices].map(([currency, amounts]) => {
      amounts.sort((a, b) => a - b);
      const middle = Math.floor(amounts.length / 2);
      return { currency, sampleCount: amounts.length, min: amounts[0], median: amounts.length % 2 ? amounts[middle] : amounts[middle - 1] / 2 + amounts[middle] / 2,
        average: amounts.reduce((mean, amount, index) => mean + (amount - mean) / (index + 1), 0), max: amounts[amounts.length - 1] };
    });
    const pricedCount = byCurrency.reduce((sum, bucket) => sum + bucket.sampleCount, 0);
    return { content: [{ type: 'text', text: JSON.stringify({ source: report.source, league: report.league, itemName: args.item_name.trim(), query: report.query,
      searchId: report.searchId, searchUrl: report.searchUrl, listingScope: report.listingScope, totalMatches: report.totalMatches, inexact: report.inexact,
      requestedCount: report.requestedCount, fetchedCount: report.fetchedCount, pricedCount, unpricedOrInvalidCount: report.fetchedCount - pricedCount,
      missingListingIds: report.missingListingIds, byCurrency, sourceTimes: report.sourceTimes, sourceFailures: report.sourceFailures,
      warnings: [...report.warnings, 'At most ten asking prices are sampled; currencies are never converted and the sample is not a complete market appraisal.',
        'Name, base, modifiers and corruption can distinguish variants with different prices.'] }) }] };
  } };
}
