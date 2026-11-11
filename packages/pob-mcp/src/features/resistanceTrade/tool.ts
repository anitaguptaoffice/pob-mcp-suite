import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { searchOfficialTrade } from '../tradeSearch/tool.js';
import { classifyBuyoutEvidence, emptyBuyoutEvidenceCounts } from '../../domain/trade/buyoutEvidence.js';

const slots: Record<string, string> = { 'Ring 1': 'Ring', 'Ring 2': 'Ring', Amulet: 'Amulet', Belt: 'Belt', Gloves: 'Gloves', Boots: 'Boots', Helmet: 'Helmet', 'Body Armour': 'Body Armour' };
const resistances = { fire: 'pseudo.pseudo_total_fire_resistance', cold: 'pseudo.pseudo_total_cold_resistance', lightning: 'pseudo.pseudo_total_lightning_resistance', chaos: 'pseudo.pseudo_total_chaos_resistance' } as const;

export function resistanceTradeSchema(): FeatureTool['schema'] {
  return { name: 'search_resistance_listings', description: 'Search individual securable, priced international Trade listings with explicit resistance targets and per-item budget. Does not calculate replacement gains or a combined shopping plan.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { league: { type: 'string' }, resistance_minimums: { type: 'object', additionalProperties: false, properties: { fire: { type: 'number', minimum: 0 }, cold: { type: 'number', minimum: 0 }, lightning: { type: 'number', minimum: 0 }, chaos: { type: 'number', minimum: 0 } } }, max_price_per_item: { type: 'number', exclusiveMinimum: 0 }, total_budget: { type: 'number', minimum: 0 }, currency: { type: 'string' }, slots: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', enum: Object.keys(slots) } }, per_slot_limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['league'] } };
}

export function createResistanceTradeTool(source: OfficialTradeSource): FeatureTool {
  return { schema: resistanceTradeSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['league', 'resistance_minimums', 'max_price_per_item', 'total_budget', 'currency', 'slots', 'per_slot_limit'].includes(key)) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100) throw new Error('Exact league and valid options are required');
    const targets = args.resistance_minimums ?? {};
    if (!targets || typeof targets !== 'object' || Array.isArray(targets) || Object.entries(targets).some(([key, value]) => !Object.hasOwn(resistances, key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid resistance minimums');
    const maxPrice = args.max_price_per_item ?? 50, budget = args.total_budget ?? 200, limit = args.per_slot_limit ?? 8, currency = args.currency ?? 'chaos';
    if (typeof maxPrice !== 'number' || !Number.isFinite(maxPrice) || maxPrice <= 0 || typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 ||
        typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10 || typeof currency !== 'string' || !/^[a-z0-9-]{1,50}$/.test(currency.trim().toLowerCase())) throw new Error('Invalid budget, currency or per-slot limit');
    const requested = args.slots ?? ['Ring 1', 'Ring 2', 'Amulet', 'Belt', 'Gloves', 'Boots', 'Helmet'];
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 8 || requested.some(slot => typeof slot !== 'string' || !Object.hasOwn(slots, slot)) || new Set(requested).size !== requested.length) throw new Error('Invalid equipment slots');
    const league = args.league.trim(), unit = currency.trim().toLowerCase(), cap = Math.min(maxPrice, budget);
    const mods = Object.entries(resistances).flatMap(([key, stat_id]) => { const value = (targets as Record<string, number>)[key]; return value > 0 ? [{ stat_id, min: value }] : []; });
    const searches = [];
    let rateLimited = false;
    if (cap > 0) for (const slot of requested as string[]) {
      if (rateLimited) { searches.push({ slot, status: 'not_attempted', error: 'Official Trade rate limit stopped this workflow' }); continue; }
      try {
        const report = await searchOfficialTrade(source, { league, item_type: slots[slot], mods, max_price: cap, price_currency: unit, status: 'securable', sale_type: 'priced', sort: 'price_asc', limit });
        const priceEvidenceCounts = emptyBuyoutEvidenceCounts();
        let excludedBudgetCount = 0;
        const listings = report.listings.filter(entry => {
          const evidence = classifyBuyoutEvidence(entry, league); priceEvidenceCounts[evidence]++;
          if (evidence !== 'explicit_buyout') return false;
          const price = entry.listing.price!;
          if (price.amount > cap || price.currency !== unit) { excludedBudgetCount++; return false; }
          return true;
        });
        searches.push({ slot, status: 'ok', query: report.query, searchUrl: report.searchUrl, totalMatches: report.totalMatches, inexact: report.inexact, requestedCount: report.requestedCount, fetchedCount: report.fetchedCount,
          excludedPriceCount: report.listings.length - listings.length, excludedBudgetCount, priceEvidenceCounts, missingListingIds: report.missingListingIds, sourceAudit: report.sourceAudit, sourceStatistics: report.sourceStatistics, sourceTimes: report.sourceTimes, sourceFailures: report.sourceFailures, warnings: report.warnings, listings });
      } catch (error) {
        const failure = error as { message?: string; code?: string; httpStatus?: number; retryAfterMs?: number };
        rateLimited = failure?.code === 'rate-limit' || failure?.httpStatus === 429;
        searches.push({ slot, status: 'error', error: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}), ...(failure?.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}) });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'official-trade', league, listingScope: 'instant_buyout', resistanceMinimums: targets, maxPricePerItem: maxPrice, totalBudget: budget, effectivePerItemCap: cap, currency: unit, perSlotLimit: limit, requestedSlots: requested, searches,
      warnings: ['Each listing is an independent candidate. The total budget only caps each item; combined affordability and net resistance after replacing current gear are not calculated.',
        'Pseudo resistance filters are source-defined and may include conditional effects; inspect the item and calculate the replacement in PoB.',
        'Only explicit buyouts with verified items in the requested league and currency are returned; evidence counts and source statistics cover all fetched listings, not just returned candidates. Evidence categories are mutually exclusive first-failure categories.',
        'Listings are sampled and can become unavailable. Inexact searches and missing listings are disclosed per slot.',
        ...(mods.length ? [] : ['No positive resistance target was supplied; searches are not resistance-filtered.']),
        ...(cap === 0 ? ['Zero total budget; no positive-price listings were queried.'] : [])] }) }] };
  } };
}
