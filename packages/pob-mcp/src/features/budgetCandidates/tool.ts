import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { tradeClipboardText } from '../../domain/trade/clipboard.js';
import { searchOfficialTrade, tradeSearchSchema } from '../tradeSearch/tool.js';
import { classifyBuyoutEvidence } from '../../domain/trade/buyoutEvidence.js';

export function budgetCandidatesSchema(): FeatureTool['schema'] {
  const tradeProperties = tradeSearchSchema().inputSchema.properties!;
  return { name: 'screen_snapshot_budget_candidates', description: 'Search explicit international equipment candidates within a chaos budget using securable priced Trade listings, then preview each candidate in PoB. This is not a complete build budget or combined optimization.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, league: { type: 'string' }, budget_chaos: { type: 'number', minimum: 0 },
    searches: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
      slot: { type: 'string' }, item_name: { type: 'string' }, item_type: { type: 'string' }, item_rarity: tradeProperties.item_rarity, max_price: { type: 'number', exclusiveMinimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 2 },
      mods: tradeProperties.mods, stat_groups: tradeProperties.stat_groups,
    }, required: ['slot'] } },
  }, required: ['snapshot_id', 'league', 'budget_chaos', 'searches'] } };
}

type Request = { slot: string; item_name?: string; item_type?: string; item_rarity?: string; max_price?: number; limit?: number; mods?: Array<{ stat_id: string; min?: number; max?: number }>; stat_groups?: Array<{ type: string; filters: Array<{ stat_id: string; min?: number; max?: number }>; min?: number; max?: number }> };
function validFilter(value: any) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['stat_id', 'min', 'max'].includes(key)) && typeof value.stat_id === 'string' && !!value.stat_id.trim() && value.stat_id === value.stat_id.trim() && value.stat_id.length <= 200 && [value.min, value.max].every(n => n === undefined || typeof n === 'number' && Number.isFinite(n)) && (value.min === undefined || value.max === undefined || value.min <= value.max);
}
export function validateBudgetCandidates(args: Record<string, unknown>): asserts args is Record<string, unknown> & { snapshot_id: string; league: string; budget_chaos: number; searches: Request[] } {
  if (Object.keys(args).some(key => !['snapshot_id', 'league', 'budget_chaos', 'searches'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 || typeof args.budget_chaos !== 'number' || !Number.isFinite(args.budget_chaos) || args.budget_chaos < 0 || !Array.isArray(args.searches) || args.searches.length < 1 || args.searches.length > 3) throw new Error('Valid snapshot, international league, nonnegative chaos budget and 1–3 searches are required');
  for (const entry of args.searches as Request[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['slot', 'item_name', 'item_type', 'item_rarity', 'max_price', 'limit', 'mods', 'stat_groups'].includes(key)) || typeof entry.slot !== 'string' || !entry.slot.trim() || entry.slot !== entry.slot.trim() || entry.slot.length > 100 || (!entry.item_name && !entry.item_type) || [entry.item_name, entry.item_type].some(value => value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 200)) || (entry.item_rarity !== undefined && !['normal', 'magic', 'rare', 'unique', 'any'].includes(entry.item_rarity)) || (entry.max_price !== undefined && (typeof entry.max_price !== 'number' || !Number.isFinite(entry.max_price) || entry.max_price <= 0)) || (entry.limit !== undefined && (!Number.isSafeInteger(entry.limit) || entry.limit < 1 || entry.limit > 2)) || (entry.mods !== undefined && (!Array.isArray(entry.mods) || entry.mods.length > 20 || entry.mods.some(filter => !validFilter(filter)))) || (entry.stat_groups !== undefined && (!Array.isArray(entry.stat_groups) || entry.stat_groups.length > 10 || entry.stat_groups.some(group => !group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['type', 'filters', 'min', 'max'].includes(key)) || !['and', 'or', 'not', 'count'].includes(group.type) || !Array.isArray(group.filters) || !group.filters.length || group.filters.length > 20 || group.filters.some(filter => !validFilter(filter)) || [group.min, group.max].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) || (group.min !== undefined && group.max !== undefined && group.min > group.max) || (group.type === 'count' && ([group.min, group.max].some(n => n !== undefined && (!Number.isInteger(n) || n < 0)) || (group.min !== undefined && group.min > group.filters.length))))))) throw new Error('Invalid candidate search');
  }
  if (new Set((args.searches as Request[]).map(entry => entry.slot)).size !== args.searches.length) throw new Error('Candidate slots must be distinct');
}

export function createBudgetCandidatesTool(foundation: Pick<BuildFoundation, 'readSnapshot' | 'previewItem'>, source: OfficialTradeSource): FeatureTool {
  return { schema: budgetCandidatesSchema(), invoke: async args => {
    validateBudgetCandidates(args);
    const snapshot = await foundation.readSnapshot(args.snapshot_id);
    if (!snapshot || snapshot.id !== args.snapshot_id) throw new Error('Snapshot identity mismatch');
    const league = args.league.trim(), searches = [];
    let rateLimited = false;
    for (const entry of args.searches) {
      if (args.budget_chaos === 0) { searches.push({ slot: entry.slot, status: 'not_attempted', reason: 'Zero budget; no positive-price listing search was attempted' }); continue; }
      if (rateLimited) { searches.push({ slot: entry.slot, status: 'not_attempted', reason: 'Official Trade rate limit stopped this workflow' }); continue; }
      const cap = Math.min(args.budget_chaos, entry.max_price ?? args.budget_chaos);
      try {
        const report = await searchOfficialTrade(source, { league, ...(entry.item_name ? { item_name: entry.item_name } : {}), ...(entry.item_type ? { item_type: entry.item_type } : {}), ...(entry.item_rarity ? { item_rarity: entry.item_rarity } : {}), ...(entry.mods ? { mods: entry.mods } : {}), ...(entry.stat_groups ? { stat_groups: entry.stat_groups } : {}), max_price: cap, price_currency: 'chaos', status: 'securable', sale_type: 'priced', identified: true, sort: 'price_asc', limit: entry.limit ?? 1 });
        const candidates = [];
        for (const listing of report.listings) {
          const price = listing.listing.price;
          const priceMatches = !!price && typeof price.amount === 'number' && Number.isFinite(price.amount) && price.amount > 0 && price.amount <= cap && price.currency === 'chaos';
          const listingEvidence = classifyBuyoutEvidence(listing, league);
          const evidence = !priceMatches ? 'outside_budget_or_unknown' : listingEvidence === 'unconfirmed_buyout' ? 'price_type_unconfirmed' : listingEvidence;
          try {
            if (!priceMatches) throw new Error('Listing price is missing, outside the chaos budget or in another currency');
            if (listingEvidence !== 'explicit_buyout') throw new Error(`Listing is not a confirmed buyout in the requested league: ${listingEvidence}`);
            const itemText = tradeClipboardText(listing, league);
            const preview = await foundation.previewItem(args.snapshot_id, entry.slot, itemText);
            candidates.push({ itemId: listing.id, price, priceEvidence: evidence, listingEvidence, listingVerified: listing.item.verified === true, status: 'previewed', preview });
          } catch (error) { candidates.push({ itemId: listing.id, price: price ?? null, priceEvidence: evidence, listingEvidence, listingVerified: typeof listing.item?.verified === 'boolean' ? listing.item.verified : null, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }); }
        }
        searches.push({ slot: entry.slot, status: 'searched', maxPriceChaos: cap, query: report.query, searchId: report.searchId, searchUrl: report.searchUrl, totalMatches: report.totalMatches, inexact: report.inexact, missingListingIds: report.missingListingIds, sourceTimes: report.sourceTimes, sourceFailures: report.sourceFailures, sourceAudit: report.sourceAudit, sourceWarnings: report.sourceWarnings, sourceStatistics: report.sourceStatistics, candidates });
      } catch (error) {
        const failure = error as { message?: string; code?: string; httpStatus?: number; retryAfterMs?: number };
        rateLimited = failure?.code === 'rate-limit' || failure?.httpStatus === 429;
        searches.push({ slot: entry.slot, status: 'error', error: failure?.message ?? String(error), ...(failure?.code ? { code: failure.code } : {}), ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: args.snapshot_id, league, budget: { amount: args.budget_chaos, currency: 'chaos' }, source: 'official-trade', listingScope: 'instant_buyout_search', complete: false, combinedCost: null, searches,
      warnings: ['Each slot is searched separately with securable and priced filters; only explicit buyouts for verified items in the requested league are previewed. Availability can change.', 'Candidates are independently previewed against the same original snapshot; interactions between multiple replacements, combined affordability, gem costs and a complete budget are not calculated.', 'A price-type-unconfirmed listing, inexact search, missing listing, unsupported modifier or preview error requires further verification.', 'Trade prices are asking prices, not completed sales; crafting costs, item legality, sockets and user-specific constraints remain unverified.'] }) }] };
  } };
}
