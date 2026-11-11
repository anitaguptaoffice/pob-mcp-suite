import { normalizeItemRaw, normalizeObservation } from '../../src/foundation/observation.js';

describe('normalizeObservation', () => {
  it('normalizes only established PoB defaults without mutating input', () => {
    const original = { items: [{ id: 0 }, { id: 1 }, { id: 0, active: true }],
      skills: { groups: [{}, { includeInFullDPS: true, mainActiveSkill: 2 }] } };
    expect(normalizeObservation(original)).toEqual({ items: [{ id: 0, active: false }, { id: 1 }, { id: 0, active: true }],
      skills: { groups: [{ includeInFullDPS: false, mainActiveSkill: 1 }, { includeInFullDPS: true, mainActiveSkill: 2 }] } });
    expect(original.skills.groups[0]).toEqual({});
    expect(original.items[0]).toEqual({ id: 0 });
  });
  it('ignores only terminal item line breaks while preserving modifiers and interior whitespace', () => {
    const raw = 'Rarity: Rare\r\nGold Ring\r\n+52 to maximum Life\r\nNote: ~b/o 1 chaos\r\n';
    const original = { items: [{ id: 1, raw }] };
    expect(normalizeObservation(original).items[0].raw).toBe(raw.slice(0, -2));
    expect(original.items[0].raw).toBe(raw);
    expect(normalizeItemRaw('a\nb\n')).not.toEqual(normalizeItemRaw('a\nc\n'));
    expect(normalizeItemRaw('a \n')).not.toEqual(normalizeItemRaw('a\n'));
    expect(normalizeItemRaw('a\n\nb\n')).toBe('a\n\nb');
  });
});
