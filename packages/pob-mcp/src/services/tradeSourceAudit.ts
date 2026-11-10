import type { TradeApiClient } from './tradeClient.js';
import type { StatFilterGroup } from '../types/tradeTypes.js';

export async function auditStatSourceCoverage(
  tradeClient: Pick<TradeApiClient, 'getStats'>,
  groups: StatFilterGroup[] | undefined,
  itemName?: string,
): Promise<string[]> {
  if (itemName || !groups?.length || typeof tradeClient.getStats !== 'function') {
    return [];
  }

  try {
    const statData = await tradeClient.getStats();
    const entries = statData.result.flatMap(category => category.entries ?? []);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const byText = new Map<string, typeof entries>();

    for (const entry of entries) {
      const siblings = byText.get(entry.text) ?? [];
      siblings.push(entry);
      byText.set(entry.text, siblings);
    }

    const warnings = new Set<string>();
    const compatibleSources = new Set(['explicit', 'implicit', 'fractured', 'crafted', 'enchant']);

    for (const group of groups) {
      const groupIds = new Set(group.filters.map(filter => filter.id));
      const filtersByText = new Map<string, string[]>();

      for (const filter of group.filters) {
        const definition = byId.get(filter.id);
        if (!definition) {
          warnings.add(`官方词缀数据中找不到 ${filter.id}，无法核对其来源覆盖。`);
          continue;
        }
        if (!compatibleSources.has(definition.type)) continue;
        const ids = filtersByText.get(definition.text) ?? [];
        ids.push(filter.id);
        filtersByText.set(definition.text, ids);
      }

      for (const [text, ids] of filtersByText) {
        if (group.type === 'and' && ids.length > 1) {
          warnings.add(`"${text}" 的相同效果使用 AND 同时要求多个来源；若它们是备选来源，应为该需求单独使用 count/or 分组。`);
        }

        if (!ids.some(id => id.startsWith('explicit.'))) continue;
        const missingSources = (byText.get(text) ?? [])
          .filter(entry => compatibleSources.has(entry.type) && !groupIds.has(entry.id))
          .map(entry => entry.type);

        if (missingSources.length > 0) {
          const uniqueSources = [...new Set(missingSources)].sort();
          warnings.add(`"${text}" 只覆盖所选词缀来源；官方数据还列出 ${uniqueSources.join(', ')}。搜索非暗金装备时，可确认适用性后将可替代来源加入该需求的 count/or 分组。`);
        }
      }
    }

    return [...warnings];
  } catch {
    // Source auditing is advisory and must not make a valid trade search fail.
    return ['无法读取官方词缀数据，未能核对来源覆盖。'];
  }
}

