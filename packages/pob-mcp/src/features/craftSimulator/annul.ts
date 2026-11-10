/** A strictly bounded one-use outcome model. It does not mutate an item. */
export interface AnnulAffix { name: string; disposition: 'keep' | 'remove' }
export interface AnnulInput {
  rarity: 'magic' | 'rare'; affixes: AnnulAffix[];
  noFractured: boolean; noProtection: boolean; noCatalyst: boolean;
  noCorruption: boolean; noMirrored: boolean; noSpecialRules: boolean;
}

export function simulateSimpleAnnul(input: AnnulInput) {
  if (!input || !['magic', 'rare'].includes(input.rarity)) throw new Error('rarity must be magic or rare');
  if (![input.noFractured, input.noProtection, input.noCatalyst, input.noCorruption, input.noMirrored, input.noSpecialRules].every(value => value === true)) {
    throw new Error('all ordinary-item assumptions must be explicitly confirmed');
  }
  const maxAffixes = input.rarity === 'magic' ? 2 : 6;
  if (!Array.isArray(input.affixes) || input.affixes.length < 1 || input.affixes.length > maxAffixes ||
      input.affixes.some(affix => !affix || typeof affix.name !== 'string' || !affix.name.trim() || !['keep', 'remove'].includes(affix.disposition))) {
    throw new Error(`provide the complete list of 1–${maxAffixes} explicit affixes`);
  }
  const count = input.affixes.length;
  const unwanted = input.affixes.filter(affix => affix.disposition === 'remove').length;
  if (!unwanted) throw new Error('at least one removable target must be specified');
  return {
    currency: 'Orb of Annulment', rarity: input.rarity, eligibleAffixes: count,
    desiredRemovalProbability: unwanted / count,
    undesiredRemovalProbability: (count - unwanted) / count,
    outcomes: input.affixes.map(affix => ({ removedAffix: affix.name, disposition: affix.disposition, probability: 1 / count })),
    assumptions: ['每条列出的外显词缀等概率被移除；一条复合词缀即使显示多行，也只能算一条。',
      '调用方确认清单完整，物品未腐化或复制，且没有分裂词缀、保护词缀、催化剂品质或其他特殊规则。'],
    warnings: ['仅模拟使用一次剥离石；结果会改变物品，不能直接当成可以重复尝试的固定概率。',
      '本工具不识别物品或核实用户输入。清单或前提有误时，不应使用该概率。'],
    source: 'https://poedb.tw/cn/Orb_of_Annulment',
  };
}
