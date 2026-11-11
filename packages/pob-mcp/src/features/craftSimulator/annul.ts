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
    assumptions: ['Each listed explicit modifier is equally likely to be removed; a hybrid modifier counts once even if displayed on multiple lines.',
      'The caller confirms the list is complete, the item is neither corrupted nor mirrored, and there are no fractured modifiers, protections, catalyst quality, or other special rules.'],
    warnings: ['This models one use of an Orb of Annulment; the item changes, so the probability cannot be assumed to remain fixed across repeated attempts.',
      'This tool does not identify the item or verify the input. Do not use these probabilities if the list or assumptions are incorrect.'],
    source: 'https://poedb.tw/cn/Orb_of_Annulment',
  };
}
