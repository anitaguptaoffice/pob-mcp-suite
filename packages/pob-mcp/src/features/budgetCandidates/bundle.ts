import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { ItemListing } from '../../types/tradeTypes.js';
import { tradeClipboardText } from '../../domain/trade/clipboard.js';
import { createSnapshotBuildComparisonTool } from '../buildComparison/tool.js';
import { searchOfficialTrade } from '../tradeSearch/tool.js';
import { budgetCandidatesSchema, validateBudgetCandidates } from './tool.js';

// Compare decimal representations without floating-point addition rounding a
// combination just above or below its budget. JSON numbers arrive as doubles;
// their shortest decimal representation is the value used by the Trade query.
function decimalParts(value: number) {
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
}
function decimalTotal(values: number[], budget: number) {
  const parts = values.map(decimalParts), limit = decimalParts(budget);
  const scale = Math.max(0, limit.scale, ...parts.map(part => part.scale));
  const scaled = (part: ReturnType<typeof decimalParts>) => part.coefficient * 10n ** BigInt(scale - part.scale);
  const total = parts.reduce((sum, part) => sum + scaled(part), 0n);
  const raw = total.toString().padStart(scale + 1, '0');
  const display = scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/\.?0+$/, '') : raw;
  return { amount: display, withinBudget: total <= scaled(limit) };
}

export function budgetBundleSchema(): FeatureTool['schema'] {
  const base = budgetCandidatesSchema().inputSchema;
  const properties = base.properties as Record<string, Record<string, unknown>>;
  return { name: 'assemble_snapshot_budget_bundle', description: 'Search bounded securable priced listings for explicit slots, sum selected explicit chaos buyouts and compare their combined PoB trial. Does not optimize a complete build or guarantee purchases.', inputSchema: { ...base, properties: { ...properties, fields: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string' } } } } };
}

export function createBudgetBundleTool(foundation: Pick<BuildFoundation, 'readSnapshot' | 'previewItem' | 'deriveItems' | 'evaluate' | 'inspect'>, source: OfficialTradeSource): FeatureTool {
  return { schema: budgetBundleSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'league', 'budget_chaos', 'searches', 'fields'].includes(key))) throw new Error('Invalid budget bundle options');
    const base = { snapshot_id: args.snapshot_id, league: args.league, budget_chaos: args.budget_chaos, searches: args.searches };
    validateBudgetCandidates(base);
    const fields = args.fields ?? ['Life', 'TotalEHP', 'FullDPS', 'MinionCombinedDPS'];
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > 20 || fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(fields).size !== fields.length) throw new Error('Invalid bundle comparison fields');
    const snapshot = await foundation.readSnapshot(base.snapshot_id);
    if (!snapshot || snapshot.id !== base.snapshot_id) throw new Error('Snapshot identity mismatch');
    const league = base.league.trim();
    const selected: Array<{ slot: string; itemId: string; price: number; itemText: string; preview: unknown; search: unknown }> = [];
    const searches: unknown[] = [];
    let incomplete: string | null = null;
    if (base.budget_chaos === 0) incomplete = 'Zero budget; no positive-price listings were searched';
    for (const entry of base.searches) {
      if (incomplete) break;
      const cap = Math.min(base.budget_chaos, entry.max_price ?? base.budget_chaos);
      try {
        const report = await searchOfficialTrade(source, { league, ...(entry.item_name ? { item_name: entry.item_name } : {}), ...(entry.item_type ? { item_type: entry.item_type } : {}), ...(entry.item_rarity ? { item_rarity: entry.item_rarity } : {}), ...(entry.mods ? { mods: entry.mods } : {}), ...(entry.stat_groups ? { stat_groups: entry.stat_groups } : {}), max_price: cap, price_currency: 'chaos', status: 'securable', sale_type: 'priced', identified: true, sort: 'price_asc', limit: entry.limit ?? 2 });
        const evidence = { slot: entry.slot, query: report.query, searchId: report.searchId, searchUrl: report.searchUrl, totalMatches: report.totalMatches, inexact: report.inexact, missingListingIds: report.missingListingIds, sourceTimes: report.sourceTimes, sourceAudit: report.sourceAudit, sourceFailures: report.sourceFailures, sourceWarnings: report.sourceWarnings, sourceStatistics: report.sourceStatistics, candidateFailures: [] as Array<{ itemId: string; error: string }> };
        searches.push(evidence);
        if (report.inexact) { incomplete = `Search for ${entry.slot} returned inexact results`; break; }
        let found: { slot: string; itemId: string; price: number; itemText: string; preview: unknown; search: unknown } | undefined;
        for (const listing of report.listings) {
          const price = listing.listing.price;
          if (selected.some(item => item.itemId.toLowerCase() === listing.id.toLowerCase())) { evidence.candidateFailures.push({ itemId: listing.id, error: 'Listing was already selected for another slot' }); continue; }
          if (listing.item.verified !== true) { evidence.candidateFailures.push({ itemId: listing.id, error: 'Listing is not confirmed verified' }); continue; }
          if (!price || price.type !== '~b/o' || price.currency !== 'chaos' || typeof price.amount !== 'number' || !Number.isFinite(price.amount) || price.amount <= 0 || price.amount > cap) { evidence.candidateFailures.push({ itemId: listing.id, error: 'Listing has no explicit chaos buyout within the per-item cap' }); continue; }
          try {
            const itemText = tradeClipboardText(listing as ItemListing, league);
            const preview = await foundation.previewItem(base.snapshot_id, entry.slot, itemText);
            found = { slot: entry.slot, itemId: listing.id, price: price.amount, itemText, preview, search: evidence }; break;
          } catch (failure) { evidence.candidateFailures.push({ itemId: listing.id, error: failure instanceof Error ? failure.message : String(failure) }); }
        }
        if (!found) { incomplete = `No verified explicit chaos buyout could be previewed for ${entry.slot}`; break; }
        selected.push(found);
      } catch (error) {
        const failure = error as { message?: string; code?: string; httpStatus?: number };
        searches.push({ slot: entry.slot, error: failure.message ?? String(error), code: failure.code ?? null, httpStatus: failure.httpStatus ?? null });
        incomplete = `Search failed for ${entry.slot}`;
      }
    }
    const completeSelection = selected.length === base.searches.length && !incomplete;
    const total = completeSelection ? decimalTotal(selected.map(item => item.price), base.budget_chaos) : null;
    let trial: unknown = null, comparison: unknown = null, error: string | null = null;
    if (total?.withinBudget) {
      try {
        const child = await foundation.deriveItems(base.snapshot_id, selected.map(item => ({ slot: item.slot, itemText: item.itemText })), true);
        trial = { snapshotId: child.id, parentId: child.parentId, retention: child.retention };
        try {
          const result = await createSnapshotBuildComparisonTool(foundation).invoke({ baseline_snapshot_id: base.snapshot_id, candidate_snapshot_id: child.id, fields });
          comparison = JSON.parse(result.content[0].text);
        } catch (failure) { error = `Trial created but comparison failed: ${failure instanceof Error ? failure.message : String(failure)}`; }
      } catch (failure) { error = `Combination was not applied: ${failure instanceof Error ? failure.message : String(failure)}`; }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: base.snapshot_id, league, budget: { amount: base.budget_chaos, currency: 'chaos' }, status: incomplete ? 'incomplete' : !total?.withinBudget ? 'over_budget' : error ? 'error' : 'compared', reason: incomplete, selected: selected.map(item => ({ slot: item.slot, itemId: item.itemId, price: { amount: item.price, currency: 'chaos', type: '~b/o' }, listingVerified: true, preview: item.preview })), searches, subtotal: total ? { amount: total.amount, currency: 'chaos', withinBudget: total.withinBudget } : null, trial, comparison, error,
      warnings: ['Each selection is the first eligible previewable item in a bounded securable priced search, not an optimum or proof of current availability.', 'The subtotal covers selected listings only; other equipment, gems, crafting, exchange fees and the full build cost are excluded.', 'PoB parsing, sockets, stat constraints, item legality and game mechanics require separate verification. An inexact search stops the bundle.', 'A trial snapshot expires after seven days unless retained. Player, minion and full damage can overlap.'] }) }] };
  } };
}
