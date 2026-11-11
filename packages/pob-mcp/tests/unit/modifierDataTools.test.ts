import { createModifierDataTools } from '../../src/features/modifierData/tools.js';
import { parseModFile } from '../../src/services/modDataStore.js';
import type { ModifierDataSource } from '../../src/ports/modifierData.js';
import { MOD_EXPLICIT_EXCERPT, MOD_MASTER_EXCERPT } from '../fixtures/modDataExcerpt.js';

const fixture = `return {
["Example"] = { type = "Prefix", affix = "Example", "+(1-5) to maximum Life", statOrder = { 1 }, level = 1, group = "Life", weightKey = { "special_ring", "ring", "default" }, weightVal = { 0, 1000, 0 }, modTags = { "life" }, },
}`;
const entry = parseModFile(fixture, 'explicit')[0];
const master = { ...entry, id: 'master:1', source: 'master' as const, itemClasses: ['Ring'], level: 20 };
const source: ModifierDataSource = { readExplicit: () => ({ entries: [entry], fileName: 'ModExplicit.lua', sha256: 'a'.repeat(64) }), readMaster: () => ({ entries: [master], fileName: 'ModMaster.lua', sha256: 'b'.repeat(64) }) };
const [classify, bench, tiers] = createModifierDataTools(source);
const call = async (tool: typeof classify, args: Record<string, unknown>) => JSON.parse((await tool.invoke(args)).content[0].text);

const excerptSource: ModifierDataSource = {
  readExplicit: () => ({ entries: parseModFile(MOD_EXPLICIT_EXCERPT, 'explicit'), fileName: 'ModExplicit.lua', sha256: 'c'.repeat(64) }),
  readMaster: () => ({ entries: parseModFile(MOD_MASTER_EXCERPT, 'master'), fileName: 'ModMaster.lua', sha256: 'd'.repeat(64) }),
};
const [excerptClassify, excerptBench, excerptTiers] = createModifierDataTools(excerptSource);
const affixesOf = (result: { groups: Array<{ tiers: Array<{ affix: string }> }> }) => result.groups.flatMap(group => group.tiers.map(tier => tier.affix));

describe('modifier data tools', () => {
  it('applies complete tags to ordered spawn rules without treating base weight as probability', async () => {
    const query = { search: 'maximum Life', item_tags: ['default', 'ring', 'special_ring'], item_tags_complete: true };
    expect((await call(tiers, query)).groups).toEqual([]);
    const zero = await call(tiers, { ...query, include_unobtainable: true });
    expect(zero.groups[0].tiers[0].firstMatchingBaseRule).toEqual({ tag: 'special_ring', weight: 0 });
    expect(zero.source.sha256).toBe('a'.repeat(64));
    const allowed = await call(tiers, { ...query, item_tags: ['ring', 'default'] });
    expect(allowed.groups[0].tiers[0].firstMatchingBaseRule).toEqual({ tag: 'ring', weight: 1000 });
    await expect(tiers.invoke({ ...query, slot_tags: ['ring'] })).rejects.toThrow('Invalid');
    await expect(tiers.invoke({ search: 'Life', item_tags: ['ring'], item_tags_complete: true })).rejects.toThrow('Invalid');
  });
  it('distinguishes item-level locks and paginates bench results', async () => {
    const result = await call(bench, { item_class: 'Ring', item_level: 10, limit: 1 });
    expect(result).toMatchObject({ withinItemLevel: 0, lockedByItemLevel: 1, total: 1, nextOffset: null });
    expect(result.mods[0].withinItemLevel).toBe(false);
  });
  it('pages through distinct modifier groups without dropping the remainder', async () => {
    const data = { ...source, readExplicit: () => ({ entries: [entry, { ...entry, id: 'second', group: 'LifeTwo' }], fileName: 'ModExplicit.lua', sha256: 'a'.repeat(64) }) };
    const tool = createModifierDataTools(data)[2];
    const first = await call(tool, { search: 'maximum Life', limit: 1 });
    const second = await call(tool, { search: 'maximum Life', limit: 1, offset: first.nextOffset });
    expect(first.totalGroups).toBe(2); expect(first.nextOffset).toBe(1);
    expect(second.groups[0].group).not.toBe(first.groups[0].group); expect(second.nextOffset).toBeNull();
  });
  it('does not assert open slots for incomplete or unmatched input', async () => {
    const unknown = await call(classify, { mod_lines: ['+3 to maximum Life'], rarity: 'rare' });
    expect(unknown.resolution.openPrefixes).toBeNull();
    const unmatched = await call(classify, { mod_lines: ['unknown modifier'], rarity: 'rare', explicit_mods_complete: true, ordinary_capacity_confirmed: true });
    expect(unmatched.resolution.openPrefixes).toBeNull();
    expect(unmatched.resolution.unmatched).toEqual(['unknown modifier']);
  });
  it('counts a hybrid as one affix and only then reports open slots', async () => {
    const mod_lines = ['9% increased Energy Shield', '6% increased Stun and Block Recovery'];
    const rare = await call(excerptClassify, { mod_lines, rarity: 'rare', explicit_mods_complete: true, ordinary_capacity_confirmed: true });
    expect(rare.resolution).toMatchObject({ prefixCount: 1, suffixCount: 0, openPrefixes: 2, openSuffixes: 3 });
    expect(rare.resolution.affixes[0].lines).toHaveLength(2);
    const magic = await call(excerptClassify, { mod_lines, rarity: 'magic', explicit_mods_complete: true, ordinary_capacity_confirmed: true });
    expect(magic.resolution).toMatchObject({ openPrefixes: 0, openSuffixes: 1 });
  });
  it('keeps known counts but withholds slots when an explicit line is unmatched', async () => {
    const result = await call(excerptClassify, { mod_lines: ['+33% to Chaos Resistance', 'An unlisted explicit modifier'], rarity: 'rare', explicit_mods_complete: true, ordinary_capacity_confirmed: true });
    expect(result.resolution).toMatchObject({ prefixCount: 0, suffixCount: 1, openPrefixes: null, openSuffixes: null });
    expect(result.resolution.unmatched).toContain('An unlisted explicit modifier');
  });
  it('withholds slots when matched counts exceed the supplied rarity capacity', async () => {
    const result = await call(excerptClassify, { mod_lines: ['+26% to Chaos Resistance', '+31% to Chaos Resistance'], rarity: 'magic', explicit_mods_complete: true, ordinary_capacity_confirmed: true });
    expect(result.resolution.openPrefixes).toBeNull();
    expect(result.resolution.openSuffixes).toBeNull();
    expect(result.warnings.join(' ')).toContain('exceed the supplied rarity capacity');
  });
  it('filters tiers by item level without relabelling or inventing tier numbers', async () => {
    const query = { search: 'Chaos Resistance', affix_type: 'Suffix', slot_tags: ['ring'] };
    const full = await call(excerptTiers, query);
    const limited = await call(excerptTiers, { ...query, max_item_level: 65 });
    expect(affixesOf(full)).toContain('of Bameth');
    expect(affixesOf(limited)).toContain('of Exile');
    expect(affixesOf(limited)).not.toContain('of Bameth');
    expect(JSON.stringify(full)).not.toMatch(/"T\d/);
  });
  it('offers the base tag vocabulary when a slot filter matches nothing', async () => {
    const missing = await call(excerptTiers, { search: 'Chaos Resistance', slot_tags: ['chest'] });
    expect(missing.groups).toEqual([]);
    expect(missing.knownSlotTags).toContain('ring');
  });
  it('separates bench crafts the item level locks out', async () => {
    const result = await call(excerptBench, { item_class: 'Body Armour', item_level: 45, affix_type: 'Suffix', search: 'Fire Resistance' });
    expect(result).toMatchObject({ withinItemLevel: 1, lockedByItemLevel: 1 });
    expect(result.mods[0].affix).toBe('of Craft');
  });
  it('retains zero-weight Elevated candidates without treating them as craftable', async () => {
    const elevated = parseModFile(fixture
      .replace('["Example"] = { type = "Prefix", affix = "Example",', '["Elevated Shaper\'s"] = { type = "Prefix", affix = "Elevated Shaper\'s",')
      .replace('"special_ring", "ring", "default"', '"ring_shaper", "ring", "default"')
      .replace('0, 1000, 0', '0, 0, 0'), 'explicit');
    const tool = createModifierDataTools({ ...source, readExplicit: () => ({ entries: elevated, fileName: 'ModExplicit.lua', sha256: 'e'.repeat(64) }) })[2];
    const retained = await call(tool, { search: 'maximum Life', item_tags: ['ring_shaper', 'ring', 'default'], item_tags_complete: true });
    expect(retained.groups[0].tiers[0].affix).toContain('Elevated');
  });
  it('rejects empty input and malformed spawn weight arrays', async () => {
    await expect(classify.invoke({ mod_lines: [] })).rejects.toThrow('Invalid');
    expect(() => parseModFile(fixture.replace('0, 1000, 0', '0, 1000'), 'explicit')).toThrow('mismatched spawn weight');
  });
});
