import type { ToolSchema } from '../../server/toolSchemas.js';
import type { TradeApiClient } from '../../services/tradeClient.js';
import { TradeQueryBuilder } from '../../services/tradeQueryBuilder.js';
import { auditStatSourceCoverage } from '../../services/tradeSourceAudit.js';
import type { StatFilterGroup } from '../../types/tradeTypes.js';
import { collectSourceStatistics } from './sourceStatistics.js';

type Filter = { stat_id: string; min?: number; max?: number };
type Group = { type: 'and' | 'or' | 'count'; filters: Filter[]; min?: number; max?: number };

export function comparableToolSchemas(): ToolSchema[] {
  return [{ name: 'estimate_comparable_item', description: 'Search priced international PoE 1 trade listings matching user-confirmed base and official stat groups. Returns the query, link, sample count and price statistics grouped by currency. Similar items are not an exact appraisal; find IDs with search_stats and account for explicit/implicit/fractured/crafted sources.',
    inputSchema: { type: 'object', properties: {
      league: { type: 'string', description: 'Exact international league name.' },
      base_type: { type: 'string', description: 'Exact item base type, e.g. Hubris Circlet.' },
      stat_groups: { type: 'array', description: 'Explicit official trade stat requirements; use count/or for alternative sources and separate groups for separate requirements.', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['and', 'or', 'count'] },
        filters: { type: 'array', items: { type: 'object', properties: { stat_id: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } }, required: ['stat_id'] } },
        min: { type: 'number' }, max: { type: 'number' },
      }, required: ['type', 'filters'] } },
      limit: { type: 'number', description: 'Maximum listings to sample, 1–10 (default 10).' },
    }, required: ['league', 'base_type', 'stat_groups'] },
  }];
}

export async function estimateComparable(client: Pick<TradeApiClient, 'searchItems' | 'fetchItems'> & Partial<Pick<TradeApiClient, 'getStats'>>, args: Record<string, unknown>) {
  const league = typeof args.league === 'string' ? args.league.trim() : '';
  const base = typeof args.base_type === 'string' ? args.base_type.trim() : '';
  const groups = args.stat_groups as Group[];
  if (!league || !base || !Array.isArray(groups) || !groups.length) throw new Error('league, base_type and at least one stat group are required');
  if (groups.length > 10 || groups.some(group => !group || !['and', 'or', 'count'].includes(group.type) || !Array.isArray(group.filters) || !group.filters.length || group.filters.length > 20 ||
    (group.min !== undefined && !Number.isFinite(group.min)) || (group.max !== undefined && !Number.isFinite(group.max)) ||
    group.filters.some(filter => !filter || typeof filter.stat_id !== 'string' || !filter.stat_id.trim() ||
      (filter.min !== undefined && !Number.isFinite(filter.min)) || (filter.max !== undefined && !Number.isFinite(filter.max)) ||
      (filter.min !== undefined && filter.max !== undefined && filter.min > filter.max)))) {
    throw new Error('invalid stat_groups');
  }
  const normalized: StatFilterGroup[] = groups.map(group => ({ type: group.type,
    filters: group.filters.map(filter => ({ id: filter.stat_id, value: { min: filter.min, max: filter.max } })),
    ...(group.min !== undefined || group.max !== undefined ? { value: { min: group.min, max: group.max } } : {}),
  }));
  const sourceWarnings = client.getStats
    ? await auditStatSourceCoverage({ getStats: client.getStats.bind(client) }, normalized)
    : ['无法读取官方词缀来源数据，未完成来源覆盖审计。'];
  const builder = new TradeQueryBuilder().withRarity('rare').withOnlineStatus('securable').withSaleType('priced').withStatGroups(normalized).withSort('price', 'asc');
  const query = builder.build();
  query.query.type = base;
  const search = await client.searchItems(league, query);
  const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) ? Math.max(1, Math.min(10, args.limit)) : 10;
  const listings = await client.fetchItems((search.result ?? []).slice(0, limit), search.id);
  const sourceStatistics = collectSourceStatistics(listings, normalized.flatMap(group => group.filters.map(filter => filter.id)));
  const prices = new Map<string, number[]>();
  for (const item of listings) {
    const price = item.listing?.price;
    if (!price || !Number.isFinite(price.amount) || price.amount <= 0 || !price.currency) continue;
    const amounts = prices.get(price.currency) ?? [];
    amounts.push(price.amount);
    prices.set(price.currency, amounts);
  }
  const byCurrency = [...prices.entries()].map(([currency, amounts]) => {
    amounts.sort((a, b) => a - b);
    const midpoint = Math.floor(amounts.length / 2);
    return { currency, sampleCount: amounts.length, min: amounts[0], median: amounts.length % 2 ? amounts[midpoint] : (amounts[midpoint - 1] + amounts[midpoint]) / 2, max: amounts[amounts.length - 1] };
  });
  return { league, baseType: base, query, searchUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(search.id)}`,
    listingScope: 'instant_buyout', sourceWarnings, sourceStatistics, checkedAt: new Date().toISOString(), totalMatches: search.total, fetchedCount: listings.length, inexact: search.inexact === true, byCurrency,
    warnings: [...sourceWarnings, ...(search.inexact ? ['官方交易搜索标记结果为近似匹配，不能认定所有条件均严格满足。'] : []), '仅比较可即时购买的指定条件物品；卖家可离线，实际购买前仍需确认挂单有效。结果不是原物品的精确价格。', 'checkedAt 是报告生成时间；交易查询和物品详情可能来自缓存，不能作为行情抓取时间。', '最多取价格排序靠前的 10 条，统计值不是全部市场的中位数；不同通货分开统计。', '词缀来源统计只按官方 hashes 与查询 ID 精确匹配，并非验证词缀数值；hashComparable 为 false 的条件（包括综合词缀）不能以此统计来源，零计数不表示没有匹配。缺少或不完整的 hashes 不能证明不存在对应来源。listingsContainingSource 统计有该来源的物品，可能与搜索条件无关；同一物品可计入多个来源。', '词缀来源、数值、底材、腐化等未包含的条件可能显著影响价格。'] };
}
