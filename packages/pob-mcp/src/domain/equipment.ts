type ItemSet = { id: number; title: string; active: boolean; useSecondWeaponSet: boolean };
type ItemSets = { activeItemSetId: number; itemSets: ItemSet[] };
type Row = { slot: string; id: number; shown?: boolean; name?: string; baseName?: string; rarity?: string; raw?: string; active?: boolean };

/** Normalize exactly what the active PoB item set exposes; unknown visibility stays unknown. */
export function normalizeEquipment(sets: ItemSets, items: Row[]) {
  if (!sets || !Number.isSafeInteger(sets.activeItemSetId) || sets.activeItemSetId < 1 || !Array.isArray(sets.itemSets) || !sets.itemSets.length || sets.itemSets.some(set => !Number.isSafeInteger(set.id) || set.id < 1 || typeof set.title !== 'string' || typeof set.active !== 'boolean' || typeof set.useSecondWeaponSet !== 'boolean') || new Set(sets.itemSets.map(set => set.id)).size !== sets.itemSets.length || sets.itemSets.filter(set => set.active).length !== 1 || !sets.itemSets.some(set => set.id === sets.activeItemSetId && set.active)) throw new Error('PoB returned invalid active item set');
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.slot !== 'string' || !item.slot.trim() || !Number.isSafeInteger(item.id) || item.id < 0 || (item.shown !== undefined && typeof item.shown !== 'boolean') || [item.name, item.baseName, item.rarity, item.raw].some(value => value !== undefined && typeof value !== 'string')) || new Set(items.map(item => item.slot)).size !== items.length) throw new Error('PoB returned invalid equipment slots');
  const activeSet = sets.itemSets.find(set => set.active)!;
  const slots = items.map(item => {
    // PoB names abyss sockets without a space before "Swap", while the
    // parent weapon slot uses "Weapon 1 Swap".
    const weapon = /^Weapon [12](?: ?(Swap))?(?: Abyssal Socket \d+)?$/i.exec(item.slot);
    const weaponSetActive = weapon ? Boolean(weapon[1]) === activeSet.useSecondWeaponSet : null;
    const visibility = item.shown === undefined ? null : item.shown;
    const inUse = weaponSetActive === false || visibility === false ? false : visibility === null ? null : true;
    const state = item.id === 0 ? 'empty' : typeof item.raw === 'string' && item.raw.trim() && (item.name || item.baseName) ? 'equipped' : 'unresolved';
    const category = /jewel/i.test(item.slot) ? 'jewel' : /flask/i.test(item.slot) ? 'flask' : /weapon/i.test(item.slot) ? 'weapon' : 'equipment';
    return { slot: item.slot, category, inUse, visibility, weaponSetActive, state, itemId: item.id,
      item: state === 'empty' ? null : { name: item.name ?? null, baseName: item.baseName ?? null, rarity: item.rarity ?? null, raw: item.raw ?? null },
      active: typeof item.active === 'boolean' ? item.active : null };
  });
  return { activeSet, slots };
}
