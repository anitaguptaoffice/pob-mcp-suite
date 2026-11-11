import { describe, expect, it } from '@jest/globals';
import { analyzeEquippedItems, formatItemAnalysis } from '../../src/domain/itemAnalysis.js';

describe('advanced analysis data integrity', () => {
  it('does not invent missing resistances or infer CI from missing life', () => {
    const analysis = analyzeEquippedItems([{ slot: 'Ring 1', name: 'Ring' }], 'Witch', undefined, { energyShield: 1000 });
    const text = formatItemAnalysis(analysis);
    expect(text).not.toContain('Fire Resistance: 0%');
    expect(text).not.toContain('Resistances may not be capped');
    expect(text).not.toContain('Build Type: ci-es');
  });

  it('recognizes measured zero resistance as a real value', () => {
    const text = formatItemAnalysis(analyzeEquippedItems([{ slot: 'Ring 1', name: 'Ring' }], 'Witch', undefined,
      { fireRes: 0, coldRes: 75, lightningRes: 75 }));
    expect(text).toContain('Fire Resistance: 0%');
  });
});
