import { describe, expect, it, jest } from '@jest/globals';
import { analyzeEquippedItems, formatItemAnalysis } from '../../src/itemAnalyzer.js';
import { handleAnalyzeItems, handleOptimizeSkillLinks } from '../../src/handlers/advancedOptimizationHandlers.js';

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

  it('maps saved XML stats without making malformed or missing stats zero', async () => {
    const build = { Build: { className: 'Witch', PlayerStat: [{ stat: 'FireResist', value: '60' }, { stat: 'ColdResist', value: 'invalid' }] },
      Items: { Item: [{ id: '1', '#text': 'Rarity: Rare\nTest Ring\nRuby Ring' }], ItemSet: { Slot: [{ name: 'Ring 1', itemId: '1' }] } } };
    const context = { pobDirectory: '', ensureLuaClient: async () => { throw new Error('offline'); }, getLuaClient: () => null,
      buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleAnalyzeItems>[0];
    const text = (await handleAnalyzeItems(context, 'saved')).content[0].text;
    expect(text).toContain('Fire Resistance: 60%');
    expect(text).not.toContain('Cold Resistance: 0%');
    expect(text).toContain('未进行实时计算');
  });

  it('does not substitute saved skills for an empty live skill set', async () => {
    const readBuild = jest.fn(async () => ({ Skills: { SkillSet: { Skill: [{ Gem: { name: 'Vortex' } }] } } }));
    const client = { getBuildInfo: async () => ({ name: 'saved' }), getSkills: async () => ({ groups: [] }),
      getTree: async () => ({ classId: 3 }), getStats: async () => ({ Life: 100 }) };
    const context = { pobDirectory: '/unused', ensureLuaClient: async () => {}, getLuaClient: () => client,
      buildService: { readBuild } } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'saved')).content[0].text;
    expect(text).toContain('No skill groups found');
    expect(text).toContain('当前内存构筑');
    expect(readBuild).not.toHaveBeenCalled();
  });

  it('uses the saved main-skill group rather than assuming the first', async () => {
    const build = { Build: { className: 'Witch', mainSocketGroup: '2' }, Skills: { SkillSet: { id: '1', Skill: [
      { label: 'First', Gem: { name: 'Fireball', level: '1', quality: '0' } },
      { label: 'Second', Gem: { name: 'Vortex', level: '1', quality: '0' } },
    ] } } };
    const context = { pobDirectory: '', ensureLuaClient: async () => { throw new Error('offline'); }, getLuaClient: () => null,
      buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'saved')).content[0].text;
    expect(text).toContain('Group 2 (MAIN)');
    expect(text).not.toContain('Group 1 (MAIN)');
  });
});
