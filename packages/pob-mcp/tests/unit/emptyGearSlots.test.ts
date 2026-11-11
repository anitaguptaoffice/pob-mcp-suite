import { describe, it, expect } from '@jest/globals';
import { analyzeEquippedItems, isEquippableGearSlot } from '../../src/domain/itemAnalysis.js';

// PoB's slot set is version-dependent (current ItemsTab baseSlots include
// Ring 3 and Graft 1/2). Both equipment-slot consumers used to iterate a
// frozen 3.27-era name list: current-PoB empty slots went unreported while
// old builds got phantom empty-slot spam. The engine's own slot output is
// now the source of truth, filtered by isEquippableGearSlot.

describe('isEquippableGearSlot', () => {
  it('keeps real gear slots including version-specific ones', () => {
    for (const slot of ['Weapon 1', 'Weapon 2', 'Ring 3', 'Graft 1', 'Graft 2', 'Belt', 'Flask 2', 'Tincture']) {
      expect(isEquippableGearSlot(slot)).toBe(true);
    }
  });

  it('drops synthetic sub-slots', () => {
    for (const slot of ['Weapon 1 Swap', 'Weapon 1Swap Abyssal Socket 5', 'Weapon 2 Abyssal Socket 2', 'Small Jewel Socket 1', 'Notable Cluster Jewel Socket 2']) {
      expect(isEquippableGearSlot(slot)).toBe(false);
    }
  });
});

describe('analyzeEquippedItems derives slots from the reported items', () => {
  const items = [
    { slot: 'Weapon 1', name: 'Doombringer', rarity: 'Unique' },
    { slot: 'Helmet', name: 'Nullrune Hood', rarity: 'Unique' },
    { slot: 'Ring 3', name: '', shown: true },     // empty on a 3-ring build
    { slot: 'Graft 1', name: '', shown: true },    // empty, tree supports it
    { slot: 'Weapon 1 Swap', name: 'Junk Wand' },
    { slot: 'Weapon 1Swap Abyssal Socket 5', name: 'Abyss Jewel' },
    { slot: 'Small Jewel Socket 1', name: 'Divergent Lineage' },
  ];

  const analyzed = analyzeEquippedItems(items, 'Scion', undefined, { life: 5000 });
  const slots = analyzed.slotAnalysis.map((s) => s.slot);

  it('reports slots that exist only on newer PoB versions', () => {
    expect(slots).toContain('Ring 3');
    expect(slots).toContain('Graft 1');
    const ring3 = analyzed.slotAnalysis.find((s) => s.slot === 'Ring 3')!;
    expect(ring3.issues).toContain('Slot is empty');
    expect(ring3.priority).toBe('high');
  });

  it('never analyzes synthetic sub-slots', () => {
    expect(slots).not.toContain('Weapon 1 Swap');
    expect(slots).not.toContain('Weapon 1Swap Abyssal Socket 5');
    expect(slots).not.toContain('Small Jewel Socket 1');
  });

  it('analyzes only what was reported - no phantom empties for absent slots', () => {
    // items above carry no Belt/Boots entries at all: the old fixed list
    // invented 'Slot is empty' issues for all 13 other names.
    expect(slots).not.toContain('Belt');
    expect(slots).not.toContain('Boots');
    expect(analyzed.slotAnalysis).toHaveLength(4); // Weapon1, Helmet, Ring3, Graft1
  });

  it('skips slots PoB hides for this build (shown=false)', () => {
    // get_items marks Ring 3 / Grafts shown=false unless the build actually
    // has the flag / tree; those are not applicable slots, not empties.
    const hidden = analyzeEquippedItems(
      [
        { slot: 'Weapon 1', name: 'Doombringer', shown: true },
        { slot: 'Ring 3', name: '', shown: false },
        { slot: 'Graft 1', name: '', shown: false },
        { slot: 'Graft 2', name: '', shown: false },
      ],
      'Scion', undefined, { life: 5000 },
    );
    const analyzed = hidden.slotAnalysis.map((s) => s.slot);
    expect(analyzed).toEqual(['Weapon 1']);
  });

  it('never hides a slot that HOLDS an item, whatever the gate says', () => {
    // An equipped item is data even if the UI gate hides its slot (or the
    // gate info is stale/absent): hiding it silently drops equipped gear.
    const held = analyzeEquippedItems(
      [
        { slot: 'Ring 3', name: 'Circle of Ambition', baseName: 'Ruby Ring', shown: false },
        { slot: 'Graft 1', name: 'Some Graft', shown: false },
      ],
      'Scion', undefined, { life: 5000 },
    );
    const analyzed = held.slotAnalysis.map((s) => s.slot);
    expect(analyzed).toContain('Ring 3');
    expect(analyzed).toContain('Graft 1');
  });

  it('keeps empty base weapon slots shown when the swap set is active', () => {
    // Weapon N with shown=false only means the active item set uses the swap
    // set (ItemsTab L129-131). The Swap slot itself is filtered as a
    // sub-slot, so hiding Weapon N would leave the build with no weapon
    // analysis at all; the pre-gate behavior (analyze it) is kept.
    const swapActive = analyzeEquippedItems(
      [
        { slot: 'Weapon 1', name: '', shown: false },
        { slot: 'Weapon 2', name: '', shown: false },
        { slot: 'Helmet', name: 'H', shown: true },
      ],
      'Scion', undefined, { life: 5000 },
    );
    const analyzed = swapActive.slotAnalysis.map((s) => s.slot);
    expect(analyzed).toContain('Weapon 1');
    expect(analyzed).toContain('Weapon 2');
  });
});
