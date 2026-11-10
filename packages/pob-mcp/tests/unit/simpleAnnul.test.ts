import { describe, expect, it } from '@jest/globals';
import { simulateSimpleAnnul, type AnnulInput } from '../../src/features/craftSimulator/annul.js';

const ordinary: AnnulInput = { rarity: 'rare', affixes: [
  { name: 'life', disposition: 'keep' }, { name: 'hybrid armour and stun recovery', disposition: 'keep' },
  { name: 'unwanted suffix', disposition: 'remove' }, { name: 'resistance', disposition: 'keep' },
], noFractured: true, noProtection: true, noCatalyst: true, noCorruption: true, noMirrored: true, noSpecialRules: true };

describe('single-use annul outcome enumeration', () => {
  it('counts affixes rather than printed modifier lines', () => {
    const result = simulateSimpleAnnul(ordinary);
    expect(result.eligibleAffixes).toBe(4);
    expect(result.desiredRemovalProbability).toBe(0.25);
    expect(result.undesiredRemovalProbability).toBe(0.75);
    expect(result.outcomes.every(outcome => outcome.probability === 0.25)).toBe(true);
  });
  it('refuses unknown protection or catalyst state and impossible affix counts', () => {
    expect(() => simulateSimpleAnnul({ ...ordinary, noCatalyst: false })).toThrow('assumptions');
    expect(() => simulateSimpleAnnul({ ...ordinary, noFractured: false })).toThrow('assumptions');
    expect(() => simulateSimpleAnnul({ ...ordinary, rarity: 'magic' })).toThrow('1–2');
    expect(() => simulateSimpleAnnul({ ...ordinary, affixes: [] })).toThrow();
  });
});
