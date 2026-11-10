/** Saved-build equipment inventory for the shopping workflow. */
import type { PoBBuild } from '../types.js';
import { activeItemSlotsOf, activeSpecTreeVersion, itemTextMapOf } from '../utils/pobXml.js';
import { isEquippableGearSlot, isGearSlotVisible } from '../itemAnalyzer.js';

export type BudgetTier = 'budget' | 'medium' | 'endgame';
export interface ShoppingListItem {
  slot: string;
  state: 'equipped' | 'empty' | 'unresolved';
  currentItem?: { name: string; rarity: string };
}
export interface ShoppingList {
  buildName: string;
  league: string;
  items: ShoppingListItem[];
}

const normalizedSlot = (slot: string): string => ({ Weapon1: 'Weapon 1', Weapon2: 'Weapon 2', Ring1: 'Ring 1', Ring2: 'Ring 2' } as Record<string, string>)[slot] ?? slot;

function readItemIdentity(text: string): { name: string; rarity: string } {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const rarityIndex = lines.findIndex(line => /^Rarity:/i.test(line));
  const rarity = rarityIndex >= 0 ? lines[rarityIndex].replace(/^Rarity:\s*/i, '') : 'Unknown';
  const name = rarityIndex >= 0 ? lines.slice(rarityIndex + 1).find(line => line && !line.startsWith('----')) : undefined;
  return { name: name ?? 'Unknown', rarity };
}

export class ShoppingListService {
  async generateShoppingList(build: PoBBuild, buildName: string, league: string): Promise<ShoppingList> {
    const treeVersion = activeSpecTreeVersion(build);
    const itemTexts = itemTextMapOf(build);
    const items: ShoppingListItem[] = [];
    const seen = new Set<string>();
    for (const entry of activeItemSlotsOf(build)) {
      if (!entry.name) continue;
      const slot = normalizedSlot(entry.name);
      const itemId = entry.itemId == null ? '' : String(entry.itemId);
      const filled = Boolean(itemId && itemId !== '0');
      if (/flask/i.test(slot) || !isEquippableGearSlot(slot) || seen.has(slot) || !isGearSlotVisible(slot, { treeVersion, filled })) continue;
      seen.add(slot);
      if (!itemId) { items.push({ slot, state: 'unresolved' }); continue; }
      if (!filled) { items.push({ slot, state: 'empty' }); continue; }
      const text = itemTexts.get(itemId);
      items.push(text ? { slot, state: 'equipped', currentItem: readItemIdentity(text) } : { slot, state: 'unresolved' });
    }
    return { buildName, league, items };
  }
}
