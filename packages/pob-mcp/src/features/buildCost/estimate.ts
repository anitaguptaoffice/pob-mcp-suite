import type { PriceCategory, PriceLine, PriceSnapshot } from './priceTypes.js';

export interface CostItem { slot: string; id: number; name?: string; baseName?: string; type?: string; rarity?: string; raw?: string; shown?: boolean }
export interface CostGem { name: string; level: number; quality: number; qualityId?: string; enabled: boolean; isSupport?: boolean }
export interface CostGroup { index: number; label?: string; enabled?: boolean; slotEnabled?: boolean; gems: CostGem[] }
export interface CostEntry {
  kind: 'item' | 'gem'; slot: string; name: string; status: 'reference' | 'unknown';
  chaos?: number; samples?: number; fetchedAt?: string; note: string;
}
export interface CostReport {
  league: string; currency: 'chaos'; estimatedSubtotal: number; pricedCount: number;
  unknownCount: number; complete: false; entries: CostEntry[]; warnings: string[];
}
export interface PriceSource { get(league: string, category: PriceCategory): Promise<PriceSnapshot> }

const uniqueCategories: PriceCategory[] = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel'];
// These jewels' prices depend on details not encoded by the generic name/base.
const variableJewels = new Set(['elegant hubris', 'militant faith', 'brutal restraint', 'glorious vanity', 'lethal pride', 'impossible escape', 'split personality', 'forbidden flame', 'forbidden flesh', 'that which was taken']);
const normalize = (s: unknown) => String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const validPrice = (line: PriceLine) => Number.isFinite(line.chaosValue) && line.chaosValue > 0;

/** Pure matching is separate from data acquisition and never guesses between variants. */
export function matchUnique(item: CostItem, lines: PriceLine[]): { line?: PriceLine; reason: string } {
  if (!item.name || !item.baseName || !item.raw) return { reason: 'Item name, base or raw text is missing' };
  if (variableJewels.has(normalize(item.name))) return { reason: 'Jewel price depends on its seed or special attributes; check separately' };
  if (/\bcorrupted\b|\bmirrored\b|\bsynthesised item\b|\bfractured item\b/i.test(item.raw)) {
    return { reason: 'Corrupted or special items require a trade search for their actual modifiers' };
  }
  const sockets = /^Sockets:\s*(.+)$/im.exec(item.raw)?.[1];
  if (sockets && sockets.trim().split(/\s+/).some(group => group.split('-').filter(Boolean).length >= 5)) {
    return { reason: 'The item has five or six linked sockets; the generic unique price does not establish the price of that link configuration.' };
  }
  if (/\{(?:crafted|enchant|fractured|synthesis|crucible|scourge|eater|exarch)(?::[^}]*)?\}/i.test(item.raw)) {
    return { reason: 'The item has crafted, enchanted, or special modifiers and requires a separate price check.' };
  }
  const found = lines.filter(line => normalize(line.name) === normalize(item.name) && normalize(line.baseType) === normalize(item.baseName) && validPrice(line));
  if (found.length !== 1 || found[0].variant || found[0].links || found[0].corrupted ||
      (found[0].explicitModifiers ?? []).filter(mod => mod.optional).length > 0) {
    return { reason: found.length ? 'Variants, links or variable modifiers require a separate price check' : 'No matching reference price' };
  }
  return { line: found[0], reason: 'Standard variant reference; modifier values and special modifiers may affect the actual price' };
}

export function matchGem(gem: CostGem, lines: PriceLine[]): { line?: PriceLine; reason: string } {
  if (!gem.name || !Number.isFinite(gem.level) || !Number.isFinite(gem.quality)) return { reason: 'Gem information is incomplete' };
  if (gem.qualityId && normalize(gem.qualityId) !== 'default') return { reason: 'Non-default gem quality requires a separate price check' };
  const gemName = normalize(gem.name);
  const found = lines.filter(line => (normalize(line.name) === gemName ||
    (gem.isSupport === true && !gemName.endsWith(' support') && normalize(line.name) === `${gemName} support`)) &&
    line.gemLevel === gem.level && (line.gemQuality ?? 0) === gem.quality && validPrice(line));
  // PoB's gem state does not reliably record corruption. More than one matching
  // variant must remain unknown; never pick the cheaper corrupted version.
  if (found.length !== 1) return { reason: found.length ? 'Multiple variants exist and PoB does not provide enough information to distinguish them' : 'No reference price for this level and quality' };
  if (found[0].corrupted === true || /c$/i.test(found[0].variant ?? '')) {
    return { reason: 'Only a corrupted reference was found; PoB did not confirm corruption, so check separately' };
  }
  return { line: found[0], reason: 'Non-corrupted reference matching level and quality; PoB did not confirm actual corruption' };
}

export async function estimateBuildCost(source: PriceSource, league: string, items: CostItem[], groups: CostGroup[]): Promise<CostReport> {
  if (!league.trim()) throw new Error('league is required');
  const equipped = items.filter(item => item.id > 0 && item.shown !== false);
  const gems = groups.flatMap(group => group.gems.map(gem => ({ gem, slot: group.label || `Skill group ${group.index}`, groupEnabled: group.enabled !== false, slotEnabled: group.slotEnabled })));
  const categories: PriceCategory[] = [];
  if (equipped.some(item => normalize(item.rarity) === 'unique')) categories.push(...uniqueCategories);
  if (gems.length) categories.push('SkillGem');
  const snapshots = new Map<PriceCategory, PriceSnapshot>();
  const errors = new Map<PriceCategory, string>();
  // Limit concurrency and share a cache through the source.
  for (let i = 0; i < categories.length; i += 2) {
    await Promise.all(categories.slice(i, i + 2).map(async category => {
      try { snapshots.set(category, await source.get(league, category)); }
      catch (error) { errors.set(category, error instanceof Error ? error.message : String(error)); }
    }));
  }
  const entries: CostEntry[] = [];
  const allUnique = uniqueCategories.flatMap(category => snapshots.get(category)?.lines ?? []);
  for (const item of equipped) {
    const name = item.name || item.baseName || 'Unnamed item';
    if (normalize(item.rarity) !== 'unique') {
      entries.push({ kind: 'item', slot: item.slot, name, status: 'unknown', note: 'Rare and other equipment requires modifier-based trade searches and is unpriced' });
      continue;
    }
    // Missing categories make a negative/unique match incomplete; do not guess.
    const match = uniqueCategories.some(category => errors.has(category))
      ? { reason: 'Some market categories failed; matching is incomplete' } : matchUnique(item, allUnique);
    const snapshot = match.line && uniqueCategories.map(category => snapshots.get(category)).find(s => s?.lines.includes(match.line!));
    entries.push({ kind: 'item', slot: item.slot, name, status: match.line ? 'reference' : 'unknown',
      chaos: match.line?.chaosValue, samples: match.line?.listingCount ?? match.line?.count, fetchedAt: snapshot?.fetchedAt, note: match.reason });
  }
  const gemSnapshot = snapshots.get('SkillGem');
  for (const { gem, slot, groupEnabled, slotEnabled } of gems) {
    if (!groupEnabled || !gem.enabled) {
      entries.push({ kind: 'gem', slot, name: gem.name, status: 'unknown', note: 'Disabled group or gem may be a backup and is excluded from the subtotal' });
      continue;
    }
    if (slotEnabled !== true) {
      entries.push({ kind: 'gem', slot, name: gem.name, status: 'unknown', note: slotEnabled === false
        ? 'The skill group belongs to an inactive equipment slot and is excluded from the subtotal.'
        : 'The skill group equipment-slot state is unknown; this gem is excluded from the subtotal.' });
      continue;
    }
    const match = gemSnapshot ? matchGem(gem, gemSnapshot.lines) : { reason: 'Gem reference prices unavailable' };
    entries.push({ kind: 'gem', slot, name: gem.name, status: match.line ? 'reference' : 'unknown',
      chaos: match.line?.chaosValue, samples: match.line?.listingCount ?? match.line?.count, fetchedAt: gemSnapshot?.fetchedAt,
      note: `${match.reason}; level ${gem.level}, quality ${gem.quality}%; ${gem.enabled ? 'gem enabled' : 'gem disabled'}` });
  }
  const priced = entries.filter(entry => entry.status === 'reference' && entry.chaos !== undefined);
  return { league, currency: 'chaos', estimatedSubtotal: priced.reduce((sum, entry) => sum + entry.chaos!, 0),
    pricedCount: priced.length, unknownCount: entries.length - priced.length, complete: false, entries,
    warnings: [
      'Reference subtotal only; not a complete build cost or a purchasable price. Unknown items are excluded, not treated as zero.',
      'Passive tree jewels, tattoos, enchantments, crafting, upgrades and other unexposed costs are not fully priced.',
      'Skill groups may include backup or duplicate gems; check actual purchases. Prices refer to the specified international league.',
      ...[...errors].map(([category, error]) => `${category} reference unavailable: ${error}`),
    ] };
}
