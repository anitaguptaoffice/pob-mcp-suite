import { normalizeObservation } from '../../src/foundation/observation.js';

describe('normalizeObservation', () => {
  it('normalizes only established PoB defaults without mutating input', () => {
    const original = { items: [{ id: 0 }, { id: 1 }, { id: 0, active: true }],
      skills: { groups: [{}, { includeInFullDPS: true, mainActiveSkill: 2 }] } };
    expect(normalizeObservation(original)).toEqual({ items: [{ id: 0, active: false }, { id: 1 }, { id: 0, active: true }],
      skills: { groups: [{ includeInFullDPS: false, mainActiveSkill: 1 }, { includeInFullDPS: true, mainActiveSkill: 2 }] } });
    expect(original.skills.groups[0]).toEqual({});
    expect(original.items[0]).toEqual({ id: 0 });
  });
});
