import type { PriceCategory, PriceLine, PriceSnapshot } from './ninjaPrices.js';

export interface CostItem { slot: string; id: number; name?: string; baseName?: string; type?: string; rarity?: string; raw?: string; shown?: boolean }
export interface CostGem { name: string; level: number; quality: number; qualityId?: string; enabled: boolean; isSupport?: boolean }
export interface CostGroup { index: number; label?: string; enabled?: boolean; gems: CostGem[] }
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
  if (!item.name || !item.baseName || !item.raw) return { reason: '缺少物品名称、底材或原文' };
  if (variableJewels.has(normalize(item.name))) return { reason: '珠宝价格取决于种子或特殊属性，需单独核价' };
  if (/\bcorrupted\b|\bmirrored\b|\bsynthesised item\b|\bfractured item\b/i.test(item.raw)) {
    return { reason: '腐化或特殊物品需按实际词缀交易查询' };
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
    return { reason: found.length ? '存在版本、连接数或可变词缀，需单独核价' : '没有匹配的行情' };
  }
  return { line: found[0], reason: '普通版本行情参考；属性数值及特殊词缀可能影响实际价格' };
}

export function matchGem(gem: CostGem, lines: PriceLine[]): { line?: PriceLine; reason: string } {
  if (!gem.name || !Number.isFinite(gem.level) || !Number.isFinite(gem.quality)) return { reason: '宝石信息不完整' };
  if (gem.qualityId && normalize(gem.qualityId) !== 'default') return { reason: '宝石品质类型不是默认类型，需按实际版本单独核价' };
  const gemName = normalize(gem.name);
  const found = lines.filter(line => (normalize(line.name) === gemName ||
    (gem.isSupport === true && !gemName.endsWith(' support') && normalize(line.name) === `${gemName} support`)) &&
    line.gemLevel === gem.level && (line.gemQuality ?? 0) === gem.quality && validPrice(line));
  // PoB's gem state does not reliably record corruption. More than one matching
  // variant must remain unknown; never pick the cheaper corrupted version.
  if (found.length !== 1) return { reason: found.length ? '存在腐化等多个版本，PoB 未提供足够信息区分' : '没有对应等级和品质的行情' };
  if (found[0].corrupted === true || /c$/i.test(found[0].variant ?? '')) {
    return { reason: '仅找到腐化版本行情，而 PoB 未确认宝石腐化状态，需单独核价' };
  }
  return { line: found[0], reason: '按等级和品质匹配的非腐化版本行情参考；PoB 未确认实际腐化状态' };
}

export async function estimateBuildCost(source: PriceSource, league: string, items: CostItem[], groups: CostGroup[]): Promise<CostReport> {
  if (!league.trim()) throw new Error('league is required');
  const equipped = items.filter(item => item.id > 0 && item.shown !== false);
  const gems = groups.flatMap(group => group.gems.map(gem => ({ gem, slot: group.label || `技能组 ${group.index}`, groupEnabled: group.enabled !== false })));
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
    const name = item.name || item.baseName || '未命名物品';
    if (normalize(item.rarity) !== 'unique') {
      entries.push({ kind: 'item', slot: item.slot, name, status: 'unknown', note: '稀有及其他装备需按词缀进行交易查询，未计价' });
      continue;
    }
    // Missing categories make a negative/unique match incomplete; do not guess.
    const match = uniqueCategories.some(category => errors.has(category))
      ? { reason: '部分行情分类读取失败，无法完整匹配' } : matchUnique(item, allUnique);
    const snapshot = match.line && uniqueCategories.map(category => snapshots.get(category)).find(s => s?.lines.includes(match.line!));
    entries.push({ kind: 'item', slot: item.slot, name, status: match.line ? 'reference' : 'unknown',
      chaos: match.line?.chaosValue, samples: match.line?.listingCount ?? match.line?.count, fetchedAt: snapshot?.fetchedAt, note: match.reason });
  }
  const gemSnapshot = snapshots.get('SkillGem');
  for (const { gem, slot, groupEnabled } of gems) {
    if (!groupEnabled || !gem.enabled) {
      entries.push({ kind: 'gem', slot, name: gem.name, status: 'unknown', note: '技能组或宝石已禁用，可能是备用配置，未计入小计' });
      continue;
    }
    const match = gemSnapshot ? matchGem(gem, gemSnapshot.lines) : { reason: '技能宝石行情不可用' };
    entries.push({ kind: 'gem', slot, name: gem.name, status: match.line ? 'reference' : 'unknown',
      chaos: match.line?.chaosValue, samples: match.line?.listingCount ?? match.line?.count, fetchedAt: gemSnapshot?.fetchedAt,
      note: `${match.reason}；等级 ${gem.level}，品质 ${gem.quality}%；${gem.enabled ? '宝石已启用' : '宝石已禁用'}` });
  }
  const priced = entries.filter(entry => entry.status === 'reference' && entry.chaos !== undefined);
  return { league, currency: 'chaos', estimatedSubtotal: priced.reduce((sum, entry) => sum + entry.chaos!, 0),
    pricedCount: priced.length, unknownCount: entries.length - priced.length, complete: false, entries,
    warnings: [
      '仅为行情参考小计，不是整套造价或可成交价格。未知物品未计入，不视为零。',
      '尚未计价天赋树珠宝、纹身、附魔、工艺、升级消耗及其他 PoB 未暴露的内容；不可判定总价完整。',
      '技能组可能包含备用或重复配置，请核对实际需要购买的宝石；价格来自国际服指定赛季。',
      ...[...errors].map(([category, error]) => `${category} 行情不可用：${error}`),
    ] };
}
