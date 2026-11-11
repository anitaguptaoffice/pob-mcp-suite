import { auditStatSourceCoverage } from '../domain/trade/sourceAudit.js';
import { wrapHandler } from '../utils/errorHandling.js';
import { TradeApiClient } from '../services/tradeClient.js';
import { TradeQueryBuilder } from '../domain/trade/queryBuilder.js';
import type { TradeQuery } from '../types/tradeTypes.js';
import { StatMapper } from '../adapters/staticStats/catalog.js';
import { ItemRecommendationEngine } from '../services/itemRecommendationEngine.js';
import {
  ItemListing,
  SearchOptions,
  ItemRecommendation,
  ResistanceRequirements,
  BudgetConstraints,
  StatFilterGroup,
  TradeStatus,
} from '../types/tradeTypes.js';
import { PoeNinjaClient } from '../services/poeNinjaClient.js';

interface TradeContext {
  tradeClient: TradeApiClient;
  statMapper?: StatMapper;
  recommendationEngine?: ItemRecommendationEngine;
  ninjaClient?: PoeNinjaClient;
}

export async function handleFindWeightedTradeItems(context: TradeContext & { getLuaClient: () => import('../pobLuaBridge.js').PoBLuaApiClient | null; ensureLuaClient: () => Promise<void> }, args: { league: string; slot: string; options?: Record<string, unknown>; limit?: number }) {
  return wrapHandler('find weighted trade items', async () => {
    if (typeof args.league !== 'string' || !args.league.trim() || typeof args.slot !== 'string' || !args.slot.trim() ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10))) throw new Error('exact league, slot and limit between 1 and 10 are required');
    if (!process.env.POE_SESSION_ID) throw new Error('find_weighted_trade_items requires POE_SESSION_ID because the official Trade API rejects anonymous weighted searches.');
    await context.ensureLuaClient();
    const client = context.getLuaClient();
    if (!client) throw new Error('Lua bridge not active. Load a build first.');
    const { query, warning } = await client.generateWeightedTradeQuery(args.slot, args.options);
    if (!query || typeof query !== 'object' || !(query as TradeQuery).query || typeof (query as TradeQuery).query !== 'object') throw new Error('PoB returned no trade query');
    const tradeQuery = query as TradeQuery;
    tradeQuery.query.status = { option: 'securable' };
    const search = await context.tradeClient.searchItems(args.league.trim(), tradeQuery);
    if (!search.result?.length) return { content: [{ type: 'text' as const, text: `=== 加权交易搜索 (${args.league.trim()}, ${args.slot}) ===\n未找到匹配的一口价物品。${warning ? `\n${warning}` : ''}${search.inexact ? '\n官方交易站标记搜索为近似匹配。' : ''}` }] };
    const items = await context.tradeClient.fetchItems(search.result.slice(0, Math.min(args.limit ?? 5, 10)), search.id);
    const lines = [`=== 加权交易搜索 (${args.league.trim()}, ${args.slot}) ===`, `匹配总数：${search.total}；展示：${items.length}；交易状态：securable`, 'PoB 权重用于筛选候选，并非逐件计算后的最优装备；请在 PoB 中验证实际替换效果。', search.inexact ? '官方交易站标记结果为近似匹配。' : '', `🔗 ${getTradeSearchUrl(args.league.trim(), search.id)}`, warning ? `Warning: ${warning}` : ''];
    for (const [index, listing] of items.entries()) {
      const item = listing.item, price = listing.listing.price;
      lines.push(`${index + 1}. ${item.name || item.typeLine}${item.name && item.typeLine && item.name !== item.typeLine ? ` (${item.typeLine})` : ''}`, price ? `   Price: ${price.amount} ${price.currency}` : '   Price: unlisted', `   Seller: ${listing.listing.account?.name ?? 'unknown'}`, '');
    }
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });
}

// ========================================
// Trade Site URL Helpers
// ========================================

function getTradeSearchUrl(league: string, searchId: string): string {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}`;
}

function getTradeItemUrl(league: string, searchId: string, itemId: string): string {
  // Individual items can be highlighted in the search results
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}#${encodeURIComponent(itemId)}`;
}

export function toStatFilters(
  stats?: Array<{ id: string; min?: number; max?: number }>,
  mods?: Array<{ stat_id: string; min?: number; max?: number }>,
): Array<{ id: string; min?: number; max?: number }> {
  if (stats?.length) return stats;
  return (mods ?? []).map(mod => ({ id: mod.stat_id, min: mod.min, max: mod.max }));
}

type PublicStatGroup = {
  type: 'and' | 'or' | 'not' | 'count' | 'weight';
  filters: Array<{ stat_id: string; min?: number; max?: number }>;
  min?: number;
  max?: number;
};

function normalizeStatGroups(groups: PublicStatGroup[] = []): StatFilterGroup[] {
  return groups.map(group => ({
    type: group.type,
    filters: group.filters.map(filter => ({
      id: filter.stat_id,
      value: {
        min: filter.min,
        max: filter.max,
      },
    })),
    value: group.min === undefined && group.max === undefined
      ? undefined
      : { min: group.min, max: group.max },
  }));
}


function formatSourceWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return `⚠️ Stat source coverage warnings:\n${warnings.map(warning => `- ${warning}`).join('\n')}\n\n`;
}

/**
 * Search the Path of Exile trade site for items
 */
export async function handleSearchTradeItems(
  context: TradeContext,
  args: {
    league: string;
    item_name?: string;
    item_type?: string;
    min_price?: number;
    max_price?: number;
    price_currency?: string;
    status?: TradeStatus;
    online_only?: boolean;
    online_status?: 'available' | 'online' | 'onlineleague' | 'securable' | 'any';
    item_rarity?: 'normal' | 'magic' | 'rare' | 'unique' | 'any';
    rarity?: 'normal' | 'magic' | 'rare' | 'unique' | 'any';
    min_links?: number;
    corrupted?: boolean;
    identified?: boolean;
    mods?: Array<{ stat_id: string; min?: number; max?: number }>;
    stats?: Array<{ id: string; min?: number; max?: number }>;
    stat_groups?: PublicStatGroup[];
    audit_sources?: boolean;
    sort?: 'price_asc' | 'price_desc';
    limit?: number;
  }
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('search trade items', async () => {
    const {
      league,
      item_name,
      item_type,
      min_price,
      max_price,
      price_currency = 'chaos',
      status,
      online_only,
      online_status,
      item_rarity,
      rarity,
      min_links,
      corrupted,
      identified,
      mods,
      stats,
      stat_groups,
      audit_sources = true,
      sort = 'price_asc',
      limit = 5,
    } = args;
    if (typeof league !== 'string' || !league.trim() || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new Error('exact league and limit between 1 and 10 are required');
    }
    const normalizedRarity = item_rarity ?? rarity;
    const normalizedStats = toStatFilters(stats, mods);

    // Build the query
    const builder = new TradeQueryBuilder();

    if (item_name) {
      builder.withName(item_name);
    }

    if (item_type) {
      builder.withType(item_type);
    }

    if (normalizedRarity) {
      builder.withRarity(normalizedRarity);
    }

    if (min_links) {
      builder.withLinks(min_links);
    }

    if (corrupted !== undefined) {
      builder.withCorrupted(corrupted);
    }

    if (identified !== undefined) {
      builder.withIdentified(identified);
    }

    if (normalizedStats && normalizedStats.length > 0) {
      builder.withStats(normalizedStats);
    }

    if (stat_groups && stat_groups.length > 0) {
      builder.withStatGroups(normalizeStatGroups(stat_groups));
    }

    builder.applyOptions({
      league,
      status: status ?? online_status ?? (online_only === undefined ? 'securable' : undefined),
      onlineOnly: online_only,
      onlineStatus: online_status,
      minPrice: min_price,
      maxPrice: max_price,
      priceCurrency: price_currency,
      sort,
      limit,
    });

    const query = builder.build();
    const sourceWarnings = audit_sources
      ? await auditStatSourceCoverage(context.tradeClient, query.query.stats, item_name)
      : [];
    const sourceWarningText = formatSourceWarnings(sourceWarnings);

    // Execute search
    const searchResult = await context.tradeClient.searchItems(league.trim(), query);

    if (!searchResult.result || searchResult.result.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `${sourceWarningText}No items found matching your search criteria in ${league.trim()} league. Status: ${query.query.status?.option ?? 'unknown'}.${searchResult.inexact ? ' 官方交易站标记搜索为近似匹配。' : ''}`,
          },
        ],
      };
    }

    // Fetch first batch of items (up to limit)
    const itemIdsToFetch = searchResult.result.slice(0, Math.min(limit, 10));
    const items = await context.tradeClient.fetchItems(itemIdsToFetch, searchResult.id);

    const output = formatSearchResults(items, searchResult.total, league.trim(), searchResult.id, query.query.status?.option ?? 'unknown', searchResult.inexact === true);

    return {
      content: [
        {
          type: 'text',
          text: `${sourceWarningText}${output}`,
        },
      ],
    };
  });
}

/**
 * Get current market price for an item
 */
export async function handleGetItemPrice(
  context: TradeContext,
  args: {
    item_name: string;
    league?: string;
    item_type?: string;
    rarity?: 'unique' | 'rare' | 'magic' | 'normal';
  }
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('get item price', async () => {
    const { item_name, league, item_type, rarity } = args;
    if (typeof item_name !== 'string' || !item_name.trim() || typeof league !== 'string' || !league.trim()) {
      throw new Error('item_name and the exact international league are required');
    }

    // Build query
    const builder = new TradeQueryBuilder()
      .withName(item_name.trim())
      .withOnlineStatus('securable')
      .withSaleType('priced');

    if (item_type) {
      builder.withType(item_type);
    }

    if (rarity) {
      builder.withRarity(rarity);
    }

    builder.withSort('price', 'asc');

    const query = builder.build();

    // Search
    const searchResult = await context.tradeClient.searchItems(league.trim(), query);
    const searchUrl = getTradeSearchUrl(league.trim(), searchResult.id);
    const warning = searchResult.inexact ? '\n⚠️ 官方交易搜索标记为近似匹配，结果可能不满足全部条件。' : '';

    if (!searchResult.result || searchResult.result.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No instant-buyout price data found for "${item_name}" in ${league}.\n${searchUrl}${warning}`,
          },
        ],
      };
    }

    // Fetch first 10 items to get price range
    const itemIdsToFetch = searchResult.result.slice(0, Math.min(10, searchResult.result.length));
    const items = await context.tradeClient.fetchItems(itemIdsToFetch, searchResult.id);

    // Calculate price statistics — flatMap narrows away unpriced listings,
    // so the price object needs no re-assertion downstream.
    const prices = items.flatMap(item =>
      item.listing?.price && Number.isFinite(item.listing.price.amount) && item.listing.price.amount > 0 && item.listing.price.currency
        ? [{ amount: item.listing.price.amount, currency: item.listing.price.currency }]
        : [],
    );

    if (prices.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No valid priced instant-buyout listings found for "${item_name}" in ${league}.\n${searchUrl}${warning}`,
          },
        ],
      };
    }

    // Group by currency
    const byCurrency = new Map<string, number[]>();
    for (const price of prices) {
      const bucket = byCurrency.get(price.currency);
      if (bucket) {
        bucket.push(price.amount);
      } else {
        byCurrency.set(price.currency, [price.amount]);
      }
    }

    // Format output
    let output = `=== Price Check: ${item_name} ===\n`;
    output += `League: ${league}\n`;
    output += `Total Listings: ${searchResult.total}\n`;
    output += `🔗 ${searchUrl}\n`;
    output += `仅统计最多 10 条可即时购买的挂牌，卖家可离线；不是成交价或全市场中位数。${warning}\n`;
    output += `数据可能来自缓存；名称、底材、词缀和腐化等差异可能影响价格。\n\n`;

    for (const [currency, amounts] of byCurrency.entries()) {
      amounts.sort((a, b) => a - b);
      const min = amounts[0];
      const max = amounts[amounts.length - 1];
      const middle = Math.floor(amounts.length / 2);
      const median = amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
      const avg = amounts.reduce((sum, val) => sum + val, 0) / amounts.length;

      const formatPrice = (value: number) => value.toLocaleString('en-US', { maximumSignificantDigits: 8 });
      output += `${currency}:\n`;
      output += `  Low: ${formatPrice(min)} ${currency}\n`;
      output += `  Median: ${formatPrice(median)} ${currency}\n`;
      output += `  Average: ${formatPrice(avg)} ${currency}\n`;
      output += `  High: ${formatPrice(max)} ${currency}\n`;
      output += `  Sample Size: ${amounts.length} listings\n\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  });
}

/**
 * Get available leagues
 */
export async function handleGetLeagues(
  context: TradeContext
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('get leagues', async () => {
    const leagueData = await context.tradeClient.getLeagues();

    if (!leagueData.result || leagueData.result.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No leagues found.',
          },
        ],
      };
    }

    let output = '=== Available Leagues ===\n\n';

    for (const league of leagueData.result) {
      output += `- ${league.id}`;
      if (league.text) {
        output += ` (${league.text})`;
      }
      if (league.realm) {
        output += ` [${league.realm}]`;
      }
      output += '\n';
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  });
}

// ========================================
// Helper Functions
// ========================================

function formatListingDetails(listing: ItemListing): string {
  const item = listing.item;
  const price = listing.listing.price;
  let output = `   价格：${price ? `${price.amount} ${price.currency}` : '未标价'}\n`;
  if (item.ilvl !== undefined) output += `   物品等级：${item.ilvl}${item.corrupted ? '（已腐化）' : ''}\n`;
  if (item.sockets?.length) output += `   最大连接数：${getMaxLinks(item.sockets)}\n`;
  const modGroups: Array<[string, string[] | undefined]> = [
    ['固定词缀', item.implicitMods], ['显式词缀', item.explicitMods], ['工艺词缀', item.craftedMods],
    ['破裂词缀', item.fracturedMods], ['附魔', item.enchantMods], ['其他词缀', item.utilityMods],
  ];
  for (const [label, mods] of modGroups) {
    if (mods?.length) output += `   ${label}：${mods.join('；')}\n`;
  }
  output += `   卖家：${listing.listing.account?.name ?? 'unknown'}（${listing.listing.account?.online ? '在线' : '离线或状态未知'}）\n`;
  return output;
}

function formatSearchResults(items: ItemListing[], totalResults: number, league: string, searchId: string, status: string, inexact: boolean): string {
  let output = `=== 交易搜索（${league}）===\n找到 ${totalResults} 条；展示 ${items.length} 条。筛选状态：${status}。\n`;
  output += `链接：${getTradeSearchUrl(league, searchId)}\n`;
  if (inexact) output += '官方交易站标记结果为近似匹配，需逐项核对。\n';
  output += '按交易站返回顺序展示，数据可能来自缓存；未计算替换装备后的收益。\n\n';
  items.forEach((listing, index) => {
    const item = listing.item;
    output += `${index + 1}. ${item.name || item.typeLine}${item.name && item.typeLine && item.name !== item.typeLine ? ` (${item.typeLine})` : ''}\n`;
    output += formatListingDetails(listing);
    output += `   链接：${getTradeItemUrl(league, searchId, listing.id)}\n\n`;
  });
  return output;
}

function getMaxLinks(sockets: Array<{ group: number }>): number {
  if (sockets.length === 0) {
    return 0;
  }
  const groups = new Map<number, number>();
  for (const socket of sockets) {
    const count = groups.get(socket.group) || 0;
    groups.set(socket.group, count + 1);
  }
  return Math.max(...groups.values());
}

/**
 * Search for stat IDs by name (fuzzy matching)
 */
export async function handleSearchStats(
  context: TradeContext,
  args: {
    query: string;
    limit?: number;
    official_sources?: boolean;
  }
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('search stats', async () => {
    const { query, limit = 10, official_sources = true } = args;

    if (official_sources) {
      try {
        const statData = await context.tradeClient.getStats();
        const entries = statData.result.flatMap(category => category.entries ?? []);
        const normalizedQuery = query.trim().toLowerCase();
        const terms = normalizedQuery.split(/\s+/).filter(Boolean);
        const matchingTexts = [...new Set(entries
          .map(entry => entry.text)
          .filter(text => terms.every(term => text.toLowerCase().includes(term))))]
          .sort((left, right) => {
            const leftText = left.toLowerCase();
            const rightText = right.toLowerCase();
            const leftRank = leftText === normalizedQuery ? 0 : leftText.startsWith(normalizedQuery) ? 1 : 2;
            const rightRank = rightText === normalizedQuery ? 0 : rightText.startsWith(normalizedQuery) ? 1 : 2;
            return leftRank - rightRank || left.localeCompare(right);
          })
          .slice(0, limit);

        if (matchingTexts.length > 0) {
          let output = `=== Official Trade Stat Sources for "${query}" ===\n\n`;
          for (const text of matchingTexts) {
            output += `${text}\n`;
            for (const entry of entries.filter(candidate => candidate.text === text)) {
              output += `- ${entry.type}: ${entry.id}\n`;
            }
            output += '\n';
          }
          output += 'Use a Pseudo stat when it matches the intended total. Otherwise put compatible source variants for one requirement in the same count/or group; keep separate mandatory requirements in separate groups.';
          return { content: [{ type: 'text', text: output }] };
        }
      } catch {
        // Fall back to the static PoB mapping when official stat data is unavailable.
      }
    }

    if (!context.statMapper) {
      return {
        content: [
          {
            type: 'text',
            text: 'Stat mapper not available.',
          },
        ],
      };
    }

    const results = context.statMapper.fuzzySearch(query, limit);

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No stats found matching "${query}".`,
          },
        ],
      };
    }

    let output = `=== Stat Search Results for "${query}" ===\n\n`;
    output += `Found ${results.length} matching stats:\n\n`;

    for (let i = 0; i < results.length; i++) {
      const stat = results[i];
      output += `${i + 1}. ${stat.pobName}\n`;
      output += `   Trade ID: ${stat.tradeId}\n`;
      output += `   Category: ${stat.category}\n`;

      if (stat.description) {
        output += `   Description: ${stat.description}\n`;
      }

      if (stat.aliases.length > 0) {
        output += `   Aliases: ${stat.aliases.slice(0, 3).join(', ')}`;
        if (stat.aliases.length > 3) {
          output += ` (+${stat.aliases.length - 3} more)`;
        }
        output += '\n';
      }

      output += '\n';
    }

    output += `\nTo use in searches, reference the Trade ID in mods or stat_groups.`;

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  });
}

// Phase 3: Recommendation Engine Handlers

export async function handleFindResistanceGear(
  context: TradeContext,
  args: {
    league: string;
    fire_resist_needed?: number;
    cold_resist_needed?: number;
    lightning_resist_needed?: number;
    chaos_resist_needed?: number;
    max_price_per_item?: number;
    total_budget?: number;
    currency?: string;
    slots?: string[];
    limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return wrapHandler('find resistance gear', async () => {
    const {
      league,
      fire_resist_needed = 0,
      cold_resist_needed = 0,
      lightning_resist_needed = 0,
      chaos_resist_needed = 0,
      max_price_per_item = 50,
      total_budget = 200,
      currency = 'chaos',
      slots,
      limit = 8,
    } = args;

    if (typeof league !== 'string' || !league.trim() || typeof currency !== 'string' || !currency.trim() ||
        !Number.isFinite(max_price_per_item) || max_price_per_item <= 0 || !Number.isFinite(total_budget) || total_budget < 0 ||
        ![fire_resist_needed, cold_resist_needed, lightning_resist_needed, chaos_resist_needed].every(n => Number.isFinite(n) && n >= 0) ||
        !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('invalid league, currency, resistance target, budget, or limit');
    if (!context.recommendationEngine) {
      return {
        content: [{ type: 'text', text: 'Recommendation engine not available.' }],
      };
    }

    const resistanceGaps: ResistanceRequirements = {
      fire: fire_resist_needed,
      cold: cold_resist_needed,
      lightning: lightning_resist_needed,
      chaos: chaos_resist_needed,
    };

    if (total_budget === 0) {
      return { content: [{ type: 'text', text: '总预算为零，无法推荐正价挂牌。' }] };
    }
    const budget: BudgetConstraints = {
      // Even an individual item cannot exceed the whole budget. Combining
      // multiple items remains out of scope and is disclosed in the report.
      maxPricePerItem: Math.min(max_price_per_item, total_budget),
      totalBudget: total_budget,
      currency: currency.trim().toLowerCase(),
    };

    const recommendations = await context.recommendationEngine.findResistanceGear(
      resistanceGaps,
      budget,
      league.trim(),
      slots
    );

    if (recommendations.length === 0) {
      return {
        content: [{ type: 'text', text: `本次在 ${league} 查询的样本中没有符合指定通货和单件预算的候选；不代表市场没有其他挂单。` }],
      };
    }

    const output = formatResistanceRecommendations(recommendations.slice(0, limit), resistanceGaps, league.trim());
    return { content: [{ type: 'text', text: output }] };
  });
}

function formatResistanceRecommendations(
  recommendations: ItemRecommendation[],
  resistanceGaps: ResistanceRequirements,
  league: string
): string {
  const targets = [];
  if (resistanceGaps.fire > 0) targets.push(`${resistanceGaps.fire}% Fire`);
  if (resistanceGaps.cold > 0) targets.push(`${resistanceGaps.cold}% Cold`);
  if (resistanceGaps.lightning > 0) targets.push(`${resistanceGaps.lightning}% Lightning`);
  if (resistanceGaps.chaos && resistanceGaps.chaos > 0) targets.push(`${resistanceGaps.chaos}% Chaos`);

  let output = `=== Resistance Gear (${league}) ===\n`;
  output += `Need: ${targets.join(', ')}\n`;
  output += `${recommendations.length} found\n`;
  output += '仅限即时购买和指定计价通货；结果可能来自缓存。以下为物品列示抗性，未扣除当前装备，不能视为替换后的净收益。\n';
  output += '各条是独立候选，未组合配装或验证总预算；请在 PoB 中核对。\n\n';

  for (const rec of recommendations) {
    const item = rec.listing.item;
    const price = rec.listing.listing.price;

    output += `${rec.rank}. ${item.name || item.typeLine}`;
    if (rec.priority === 'high') output += ' ⭐';
    output += `\n`;

    if (item.typeLine && item.name !== item.typeLine) {
      output += `   Type: ${item.typeLine}\n`;
    }

    output += `   Score: ${rec.score.toFixed(1)}/100 (${rec.priority} priority)\n`;

    if (price) {
      output += `   Price: ${price.amount} ${price.currency}\n`;
    }

    if (rec.costBenefit.resistGain) {
      const gains = [];
      const rg = rec.costBenefit.resistGain;
      if (rg.fire) gains.push(`${rg.fire}% Fire`);
      if (rg.cold) gains.push(`${rg.cold}% Cold`);
      if (rg.lightning) gains.push(`${rg.lightning}% Lightning`);
      if (rg.chaos) gains.push(`${rg.chaos}% Chaos`);

      if (gains.length > 0) {
        output += `   Listed resistance contribution: ${gains.join(', ')}\n`;
      }
    }

    if (rec.costBenefit.efficiency) {
      output += `   Efficiency: ${rec.costBenefit.efficiency.toFixed(2)} resist per ${rec.costBenefit.currency}\n`;
    }

    if (rec.reasons.length > 0) {
      output += `   Why:\n`;
      for (const reason of rec.reasons.slice(0, 2)) {
        output += `     - ${reason}\n`;
      }
    }

    for (const warning of rec.warnings ?? []) output += `   ⚠️ ${warning}\n`;
    output += `   ${rec.listing.listing.account?.online ? '🟢' : '🔴'} ${rec.listing.listing.account?.name ?? 'unknown'}\n`;
    output += `   🔗 ${getTradeItemUrl(league, rec.searchId, rec.listing.id)}\n\n`;
  }

  return output;
}

/**
 * Compare multiple trade items side-by-side
 */
export async function handleCompareTradeItems(
  context: TradeContext,
  args: {
    item_ids: string[];
    search_id?: string;
    build_context?: {
      life_needed?: number;
      es_needed?: number;
      dps_target?: number;
      fire_resist_needed?: number;
      cold_resist_needed?: number;
      lightning_resist_needed?: number;
    };
  }
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('compare trade items', async () => {
    const { item_ids, search_id, build_context } = args;

    if (!item_ids || item_ids.length === 0) {
      return {
        content: [{ type: 'text', text: 'No item IDs provided for comparison.' }],
      };
    }

    if (item_ids.length > 5) {
      return {
        content: [{ type: 'text', text: 'Can only compare up to 5 items at once.' }],
      };
    }

    const items = await context.tradeClient.fetchItems(item_ids, search_id);

    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'No items found with the provided IDs.' }],
      };
    }

    const output = formatItemComparison(items, build_context);
    return { content: [{ type: 'text', text: output }] };
  });
}

function formatItemComparison(items: ItemListing[], buildContext?: object): string {
  let output = `=== 交易物品比较（${items.length} 件）===\n`;
  output += '以下是挂牌原始信息；不同通货未换算，也未计算替换后的伤害、防御或性价比。\n';
  if (buildContext) output += '提供的 BD 需求未参与计算，请在 PoB 中核对实际替换效果。\n';
  for (const [index, listing] of items.entries()) {
    const item = listing.item;
    output += `\n${index + 1}. ${item.name || item.typeLine}${item.name && item.typeLine && item.name !== item.typeLine ? ` (${item.typeLine})` : ''}\n`;
    output += formatListingDetails(listing);
  }
  return output;
}
