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
          warnings.add(`Official stat definition not found for ${filter.id}; source coverage could not be verified.`);
          continue;
        }
        if (!compatibleSources.has(definition.type)) continue;
        const ids = filtersByText.get(definition.text) ?? [];
        ids.push(filter.id);
        filtersByText.set(definition.text, ids);
      }

      for (const [text, ids] of filtersByText) {
        if (group.type === 'and' && ids.length > 1) {
          warnings.add(`"${text}" has equivalent source variants joined with AND; use a separate count/or group for this requirement.`);
        }

        if (!ids.some(id => id.startsWith('explicit.'))) continue;
        const missingSources = (byText.get(text) ?? [])
          .filter(entry => compatibleSources.has(entry.type) && !groupIds.has(entry.id))
          .map(entry => entry.type);

        if (missingSources.length > 0) {
          const uniqueSources = [...new Set(missingSources)].sort();
          warnings.add(`"${text}" only covers selected stat sources; official data also exposes ${uniqueSources.join(', ')}. Add compatible variants to this requirement's count/or group when searching non-unique items.`);
        }
      }
    }

    return [...warnings];
  } catch {
    // Source auditing is advisory and must not make a valid trade search fail.
    return ['Official stat data unavailable; source coverage could not be verified.'];
  }
}

