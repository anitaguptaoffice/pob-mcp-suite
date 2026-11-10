import { createModifierDataTools } from '../../src/features/modifierData/tools.js';
import { parseModFile } from '../../src/services/modDataStore.js';
import type { ModifierDataSource } from '../../src/ports/modifierData.js';

const fixture = `return {
["Example"] = { type = "Prefix", affix = "Example", "+(1-5) to maximum Life", statOrder = { 1 }, level = 1, group = "Life", weightKey = { "special_ring", "ring", "default" }, weightVal = { 0, 1000, 0 }, modTags = { "life" }, },
}`;
const entry = parseModFile(fixture, 'explicit')[0];
const master = { ...entry, id: 'master:1', source: 'master' as const, itemClasses: ['Ring'], level: 20 };
const source: ModifierDataSource = { readExplicit: () => ({ entries: [entry], fileName: 'ModExplicit.lua', sha256: 'a'.repeat(64) }), readMaster: () => ({ entries: [master], fileName: 'ModMaster.lua', sha256: 'b'.repeat(64) }) };
const [classify, bench, tiers] = createModifierDataTools(source);
const call = async (tool: typeof classify, args: Record<string, unknown>) => JSON.parse((await tool.invoke(args)).content[0].text);

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
});
