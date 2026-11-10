import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { OfficialTradeSource } from '../../ports/officialTrade.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { TradeQuery } from '../../types/tradeTypes.js';
import { TrackedTrade } from '../tradeCommon/trackedTrade.js';
import { collectSourceStatistics } from '../tradeComparable/sourceStatistics.js';
import { auditWeightedSources } from './sourceAudit.js';
import { fetchVerifiedListingBatch } from '../tradeCommon/listingFetch.js';

const weightSchema = { type: 'array', minItems: 1, maxItems: 4, description: 'Choose only metrics where a higher value is better; PoB may combine player and minion damage for unprefixed damage stats.', items: { type: 'object', additionalProperties: false, properties: { stat: { type: 'string' }, weight: { type: 'number', exclusiveMinimum: 0, maximum: 100 } }, required: ['stat', 'weight'] } };
const commonProperties = { snapshot_id: { type: 'string' }, slot: { type: 'string' }, weights: weightSchema, include_corrupted: { type: 'boolean' }, include_mirrored: { type: 'boolean' }, include_eldritch: { type: 'boolean' }, include_scourge: { type: 'boolean' }, max_price: { type: 'number', exclusiveMinimum: 0 }, price_currency: { type: 'string' } };
export function weightedTradeSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'generate_snapshot_weighted_trade', description: 'Generate a PoB weighted Trade query from an isolated snapshot and explicit metric weights. Does not search or prove an upgrade.', inputSchema: { type: 'object', additionalProperties: false, properties: commonProperties, required: ['snapshot_id', 'slot', 'weights'] } },
    { name: 'search_snapshot_weighted_trade', description: 'Generate a PoB weighted query and search official international Trade with securable and priced filters. Requires Trade authentication; results are candidates, not verified upgrades.', inputSchema: { type: 'object', additionalProperties: false, properties: { ...commonProperties, league: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['snapshot_id', 'slot', 'weights', 'league'] } },
  ];
}

type Weight = { stat: string; weight: number };
function validate(args: Record<string, unknown>, search: boolean) {
  const allowed = ['snapshot_id', 'slot', 'weights', 'include_corrupted', 'include_mirrored', 'include_eldritch', 'include_scourge', 'max_price', 'price_currency', ...(search ? ['league', 'limit'] : [])];
  if (Object.keys(args).some(key => !allowed.includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.slot !== 'string' || !args.slot.trim() || args.slot !== args.slot.trim() || args.slot.length > 100 || !Array.isArray(args.weights) || args.weights.length < 1 || args.weights.length > 4 || args.weights.some((entry: Weight) => !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['stat', 'weight'].includes(key)) || typeof entry.stat !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(entry.stat) || typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight <= 0 || entry.weight > 100) || new Set(args.weights.map((entry: Weight) => entry.stat)).size !== args.weights.length) throw new Error('Valid snapshot, slot and 1–4 distinct positive metric weights are required');
  for (const key of ['include_corrupted', 'include_mirrored', 'include_eldritch', 'include_scourge']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  if ((args.max_price === undefined) !== (args.price_currency === undefined) || (args.max_price !== undefined && (typeof args.max_price !== 'number' || !Number.isFinite(args.max_price) || args.max_price <= 0)) || (args.price_currency !== undefined && (typeof args.price_currency !== 'string' || !/^[a-z0-9-]{1,100}$/.test(args.price_currency)))) throw new Error('A positive maximum price and currency must be supplied together');
  if (search && (typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 || (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 10)))) throw new Error('Valid international league and limit from 1 to 10 are required');
}

export async function generateWeightedTrade(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, args: Record<string, unknown>) {
  const weights = args.weights as Weight[], fields = weights.map(entry => entry.stat);
  const options = { statWeights: weights.map(entry => ({ label: entry.stat, stat: entry.stat, weightMult: entry.weight })),
    includeCorrupted: args.include_corrupted ?? true, includeMirrored: args.include_mirrored ?? false,
    includeEldritch: args.include_eldritch ?? false, includeScourge: args.include_scourge ?? false,
    ...(args.max_price === undefined ? {} : { maxPrice: args.max_price, maxPriceType: args.price_currency }) };
  const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id as string, async engine => {
    if (!engine.generateWeightedTradeQuery) throw new Error('PoB adapter lacks weighted trade generation');
    const values = await engine.getStats(fields);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('PoB did not provide observable stats');
    return { baseline: values, generated: await engine.generateWeightedTradeQuery(args.slot as string, options) };
  });
  const raw = result.generated?.query;
  const nativeBaselines = result.generated?.weightBaselines;
  if (!Array.isArray(nativeBaselines) || nativeBaselines.length !== weights.length || nativeBaselines.some((entry, index) => !entry || entry.stat !== weights[index].stat || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value <= 0 || !['pob_power_stat', 'full_dps_fallback_sum'].includes(entry.method))) throw new Error('PoB did not provide positive finite native baselines for all requested weights');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 200000) throw new Error('PoB returned an invalid weighted query');
  const query = structuredClone(raw) as TradeQuery;
  if (!query.query || typeof query.query !== 'object' || Array.isArray(query.query) || !Array.isArray(query.query.stats) || !query.query.stats.some(group => group && group.type === 'weight' && Array.isArray(group.filters) && group.filters.length > 0)) throw new Error('PoB returned no weighted stat filters');
  if (query.query.stats.some(group => !group || typeof group !== 'object' || !Array.isArray(group.filters) || group.filters.some(filter => !filter || typeof filter.id !== 'string' || !filter.id.trim()))) throw new Error('PoB returned invalid weighted stat filters');
  query.query.status = { option: 'securable' };
  if (query.query.filters !== undefined && (!query.query.filters || typeof query.query.filters !== 'object' || Array.isArray(query.query.filters))) throw new Error('PoB returned invalid trade filters');
  query.query.filters ??= {};
  if (query.query.filters.trade_filters !== undefined && (!query.query.filters.trade_filters || typeof query.query.filters.trade_filters !== 'object' || Array.isArray(query.query.filters.trade_filters))) throw new Error('PoB returned invalid trade filters');
  const trade = query.query.filters.trade_filters ??= { filters: {} };
  if (trade.disabled !== undefined && trade.disabled !== false) throw new Error('PoB returned disabled or invalid trade filters; cannot safely apply the priced requirement');
  if (trade.filters !== undefined && (!trade.filters || typeof trade.filters !== 'object' || Array.isArray(trade.filters))) throw new Error('PoB returned invalid trade filters');
  trade.filters ??= {};
  trade.filters.sale_type = { option: 'priced' };
  return { ...context, slot: args.slot as string, weights, options, observedStats: result.baseline, weightBaselines: nativeBaselines, query, generatorWarning: result.generated.warning ?? null,
    warnings: [...context.warnings, 'PoB generated a weighted candidate query; inspect the native baselines, metrics and filters before searching.', 'Weights must use higher-is-better metrics. Weights and listings do not prove an actual upgrade, item legality or affordability.', 'PoB power stats may combine player and minion damage; native weight baselines can differ from observedStats. FullDPS may use a different fallback per candidate.'] };
}

export function createWeightedTradeTools(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, source?: OfficialTradeSource, authenticated: () => boolean = () => false): FeatureTool[] {
  const schemas = weightedTradeSchemas();
  const generate: FeatureTool = { schema: schemas[0], invoke: async args => { validate(args, false); return { content: [{ type: 'text', text: JSON.stringify(await generateWeightedTrade(foundation, args)) }] }; } };
  if (!source) return [generate];
  return [generate, { schema: schemas[1], invoke: async args => {
    validate(args, true);
    if (!authenticated()) throw new Error('Weighted Trade search requires POE_SESSION_ID');
    const generated = await generateWeightedTrade(foundation, args), league = (args.league as string).trim(), limit = (args.limit as number | undefined) ?? 5;
    const trade = new TrackedTrade(source);
    const sourceWarnings = await auditWeightedSources(trade, generated.query.query.stats ?? []);
    const sourceAudit = trade.sourceFailures.some(failure => failure.operation === 'stats') ? 'unavailable' : 'completed';
    const search = await trade.searchItems(league, generated.query);
    const ids = search.result.slice(0, limit);
    const fetched = ids.length ? await fetchVerifiedListingBatch(source, ids, search.id) : null;
    if (fetched) trade.sourceTimes.listings = fetched.fetchedAt;
    const byId = fetched?.listings ?? new Map();
    const missingIds = fetched?.missingIds ?? [];
    const ordered = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const sourceStatistics = collectSourceStatistics(ordered, (generated.query.query.stats ?? []).flatMap(group => group.filters.map(filter => filter.id)));
    return { content: [{ type: 'text', text: JSON.stringify({ ...generated, source: 'official-trade', league, listingScope: 'instant_buyout', searchId: search.id,
      searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(search.id)}`, totalMatches: search.total, inexact: search.inexact === true,
      requestedCount: ids.length, fetchedCount: ordered.length, missingListingIds: missingIds, listings: ordered.map(({ id, item, listing }) => ({ id, item, listing: { price: listing?.price, indexed: listing?.indexed, account: listing?.account ? { name: listing.account.name } : undefined } })),
      sourceAudit, sourceWarnings, sourceStatistics, sourceTimes: trade.sourceTimes, sourceFailures: trade.sourceFailures,
      warnings: [...generated.warnings, ...(search.inexact ? ['Official Trade reports inexact results.'] : []), ...(missingIds.length ? ['Some requested listings were unavailable at fetch time.'] : []), 'Source counts match official hashes to query IDs and do not verify values; missing hashes and pseudo stats cannot establish source absence.', 'Listing availability and asking prices can change; preview each item in PoB before deciding.'] }) }] };
  } }];
}
