import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { parseModFile } from '../../src/services/modDataStore.js';
import * as store from '../../src/services/modDataStore.js';
import { firstMatchingSpawnRule } from '../../src/services/affixQuery.js';
import { handleFindAffixTiers } from '../../src/handlers/affixHandlers.js';

const fixture = `return {
["Example"] = { type = "Prefix", affix = "Example", "+(1-5) to maximum Life", statOrder = { 1 }, level = 1, group = "Life", weightKey = { "special_ring", "ring", "default" }, weightVal = { 0, 1000, 0 }, modTags = { "life" }, },
}`;
const entries = parseModFile(fixture, 'explicit');
afterEach(() => { jest.restoreAllMocks(); });

describe('ordered PoB spawn rules', () => {
  it('preserves the first matching zero-weight rule instead of selecting a later positive tag', () => {
    expect(firstMatchingSpawnRule(entries[0], ['default', 'ring', 'special_ring'])).toEqual({ tag: 'special_ring', weight: 0 });
    expect(firstMatchingSpawnRule(entries[0], ['default', 'ring'])).toEqual({ tag: 'ring', weight: 1000 });
  });

  it('only returns a positive first match when the complete tag set is confirmed', async () => {
    jest.spyOn(store, 'loadExplicitMods').mockReturnValue(entries);
    const blocked = { search: 'maximum Life', item_tags: ['default', 'ring', 'special_ring'], item_tags_complete: true };
    expect((await handleFindAffixTiers(blocked)).content[0].text).toContain('No affix data matched');
    const included = (await handleFindAffixTiers({ ...blocked, include_unobtainable: true })).content[0].text;
    expect(included).toContain('first matching base spawn rule: special_ring = 0');
    const allowed = (await handleFindAffixTiers({ ...blocked, item_tags: ['default', 'ring'] })).content[0].text;
    expect(allowed).toContain('first matching base spawn rule: ring = 1000');
    expect(allowed).toContain('not probabilities');
    await expect(handleFindAffixTiers({ search: 'Life', item_tags: ['ring'] })).rejects.toThrow('confirmed complete tag set');
    await expect(handleFindAffixTiers({ ...blocked, slot_tags: ['ring'] })).rejects.toThrow('do not combine');
  });

  it('refuses malformed weight arrays instead of applying shifted tags', () => {
    expect(() => parseModFile(fixture.replace('0, 1000, 0', '0, 1000'), 'explicit')).toThrow('mismatched spawn weight');
  });
});
