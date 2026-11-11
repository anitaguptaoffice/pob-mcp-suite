import type { StatData, StatFilterGroup } from '../../types/tradeTypes.js';

/** Audit weighted groups without suggesting boolean groups that alter their scoring. */
export async function auditWeightedSources(source: { getStats(): Promise<StatData> }, groups: StatFilterGroup[]) {
  try {
    const categories = (await source.getStats()).result;
    const entries = categories.flatMap(category => category.entries ?? []);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const byText = new Map<string, typeof entries>();
    for (const entry of entries) { const existing = byText.get(entry.text) ?? []; existing.push(entry); byText.set(entry.text, existing); }
    const warnings = new Set<string>(), supported = new Set(['explicit', 'implicit', 'fractured', 'crafted', 'enchant']);
    for (const group of groups) {
      const ids = new Set(group.filters.map(filter => filter.id));
      for (const filter of group.filters) {
        const entry = byId.get(filter.id);
        if (!entry) { warnings.add(`Official stat data does not contain ${filter.id}; source coverage could not be audited.`); continue; }
        if (!supported.has(entry.type)) continue;
        const missing = [...new Set((byText.get(entry.text) ?? []).filter(other => supported.has(other.type) && !ids.has(other.id)).map(other => other.type))].sort();
        if (missing.length) warnings.add(`"${entry.text}" has additional official sources: ${missing.join(', ')}. Check applicability and weights before changing the weighted query.`);
      }
    }
    return [...warnings];
  } catch { return ['Official stat data is unavailable; source coverage could not be audited.']; }
}
